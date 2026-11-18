import {
  Controller,
  Get,
  Post,
  Put,
  Req,
  Res,
  Body,
  Param,
  Inject,
  HttpException,
  ArgumentsHost,
  Catch,
  ExceptionFilter,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { z, ZodError } from "zod";
import { Security } from "./security";
import { Shop } from "./shop";
import { Ai } from "./ai";
import { Db } from "./db";
const cartSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            productId: z.string().max(80),
            quantity: z.number().int().min(1).max(2147483647),
          })
          .strict(),
      )
      .max(12),
  })
  .strict();
@Controller("api")
export class Api {
  constructor(
    @Inject(Security) readonly security: Security,
    @Inject(Shop) readonly shop: Shop,
    @Inject(Ai) readonly ai: Ai,
  ) {}
  @Get("session") async session(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.security.rate("ip:" + req.ip, 1200);
    const sid = await this.security.session(req, res, true);
    return this.shop.state(sid);
  }
  @Get("catalog") async catalog(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.security.authorize(req, res, "read", 120);
    return this.shop.catalog();
  }
  @Get("state") async state(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const sid = await this.security.authorize(req, res, "read", 120);
    return this.shop.state(sid);
  }
  @Put("cart") async cart(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
  ) {
    const sid = await this.security.authorize(req, res, "cart", 30);
    await this.ai.assertAvailable();
    await this.shop.setCart(sid, cartSchema.parse(body).items);
    return this.shop.state(sid);
  }
  @Post("offers") async offer(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const sid = await this.security.authorize(req, res, "offer", 10);
    await this.ai.assertAvailable();
    await this.shop.offer(sid);
    return this.shop.state(sid);
  }
  @Post("reservations") async confirm(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
  ) {
    const sid = await this.security.authorize(req, res, "confirm", 10);
    await this.ai.assertAvailable();
    const data = z
      .object({
        offerId: z.string().uuid(),
        name: z.string().trim().min(1).max(80),
        requestKey: z.string().uuid(),
        confirmed: z.literal(true),
      })
      .strict()
      .parse(body);
    await this.shop.confirm(sid, data.offerId, data.name, data.requestKey);
    return this.shop.state(sid);
  }
  @Post("reservations/:id/cancel") async cancel(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const sid = await this.security.authorize(req, res, "cancel", 10);
    z.object({ confirmed: z.literal(true) })
      .strict()
      .parse(body);
    await this.shop.finish(z.string().uuid().parse(id), "CANCELLED", sid);
    return this.shop.state(sid);
  }
  @Post("chat") async chat(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: unknown,
  ) {
    const sid = await this.security.authorize(req, res, "chat", 10);
    const { message } = z
      .object({ message: z.string().trim().min(1).max(2000) })
      .strict()
      .parse(body);
    await this.ai.assertAvailable();
    res
      .status(200)
      .set({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      });
    res.flushHeaders();
    const send = (event: string, data: unknown) => {
      if (!res.destroyed)
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const keepAlive = setInterval(() => {
      if (!res.destroyed) res.write(": keep-alive\n\n");
    }, 10000);
    try {
      await this.ai.chat(sid, message, (text) => send("delta", { text }));
      send("state", await this.shop.state(sid));
      send("done", {});
    } catch (e) {
      send("failure", {
        message:
          e instanceof HttpException ? e.message : "Atendimento indisponível.",
      });
      send("state", await this.shop.state(sid));
    } finally {
      clearInterval(keepAlive);
      res.end();
    }
  }
}
@Controller("health")
export class Health {
  constructor(@Inject(Db) readonly db: Db) {}
  @Get("live") live() {
    return { status: "ok" };
  }
  @Get("ready") async ready() {
    await this.db.$queryRaw`SELECT 1`;
    return { status: "ok" };
  }
}
@Catch()
export class Errors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent) {
      res.end();
      return;
    }
    const status =
      error instanceof ZodError
        ? 400
        : error instanceof HttpException
          ? error.getStatus()
          : 503;
    const payload =
      error instanceof HttpException
        ? error.getResponse()
        : {
            message:
              status === 400
                ? "Dados inválidos. Confira os campos."
                : "Serviço temporariamente indisponível.",
          };
    if (
      status === 429 &&
      typeof payload === "object" &&
      payload &&
      "retryAfter" in payload
    )
      res.setHeader("Retry-After", String(payload.retryAfter));
    res
      .status(status)
      .json(typeof payload === "string" ? { message: payload } : payload);
  }
}
