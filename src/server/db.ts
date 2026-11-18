import "dotenv/config";
import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { readFileSync } from "node:fs";
@Injectable()
export class Db extends PrismaClient implements OnModuleDestroy {
  constructor() {
    super({
      adapter: new PrismaPg({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_CA_PATH
          ? {
              ca: readFileSync(process.env.DATABASE_CA_PATH, "utf8"),
              rejectUnauthorized: true,
            }
          : undefined,
        max: Number(process.env.DATABASE_POOL_MAX || 3),
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 10000,
      }),
    });
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
