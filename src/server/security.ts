import {
  Injectable,
  Inject,
  HttpException,
  UnauthorizedException,
  ForbiddenException,
} from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { Db } from "./db";
import type { Request, Response } from "express";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
@Injectable()
export class Security {
  constructor(@Inject(Db) readonly db: Db) {}
  async rate(key: string, limit: number, seconds = 60) {
    const bucket = Math.floor(Date.now() / (seconds * 1000));
    const expires = new Date((bucket + 1) * seconds * 1000);
    const rows = await this.db.$queryRaw<
      { count: number }[]
    >`INSERT INTO "RateBucket" (key,count,"expiresAt") VALUES (${hash(key + ":" + bucket)},1,${expires}) ON CONFLICT (key) DO UPDATE SET count="RateBucket".count+1 RETURNING count`;
    if (rows[0].count > limit)
      throw new HttpException(
        {
          message: "Você atingiu o limite de tentativas. Aguarde um pouco.",
          retryAfter: Math.max(
            1,
            Math.ceil((expires.getTime() - Date.now()) / 1000),
          ),
        },
        429,
      );
  }
  origin(req: Request) {
    const origin = req.headers.origin;
    if (
      origin &&
      origin !== (process.env.WEB_ORIGIN || "http://localhost:5173")
    )
      throw new ForbiddenException("Origem não autorizada.");
    if (req.headers["sec-fetch-site"] === "cross-site")
      throw new ForbiddenException("Origem não autorizada.");
    if (req.method !== "GET" && req.headers["x-periferia-client"] !== "web")
      throw new ForbiddenException("Requisição não autorizada.");
  }
  async session(req: Request, res: Response, create = false) {
    this.origin(req);
    const raw = req.cookies?.periferia;
    const found =
      typeof raw === "string" && raw.length === 64
        ? await this.db.session.findUnique({ where: { tokenHash: hash(raw) } })
        : null;
    if (found && found.expiresAt > new Date()) return found.id;
    if (!create)
      throw new UnauthorizedException("Sessão expirada. Recarregue a página.");
    await this.rate("session-create:" + req.ip, 30);
    const token = randomBytes(32).toString("hex");
    const s = await this.db.session.create({
      data: {
        tokenHash: hash(token),
        expiresAt: new Date(Date.now() + 7 * 86400000),
      },
    });
    res.cookie("periferia", token, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.COOKIE_SECURE === "true",
      maxAge: 7 * 86400000,
      path: "/",
    });
    return s.id;
  }
  async authorize(req: Request, res: Response, group: string, limit: number) {
    await this.rate("ip:" + req.ip, 1200);
    const sid = await this.session(req, res);
    await this.rate(group + ":" + sid, limit);
    return sid;
  }
}
