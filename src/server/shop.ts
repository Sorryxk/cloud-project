import {
  Inject,
  Injectable,
  ConflictException,
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { Db } from "./db";
import { metric, log } from "./telemetry";
export type Line = {
  productId: string;
  name: string;
  quantity: number;
  unitCents: number;
  listUnitCents: number;
};
const json = (v: unknown) => v as Prisma.InputJsonValue;
export function floorPrice(cost: number, marginBps: number) {
  return Math.ceil((cost * 10000) / (10000 - marginBps));
}
export function unitPrice(
  price: number,
  cost: number,
  marginBps: number,
  discountBps: number,
) {
  return Math.max(
    Math.ceil(
      (price * (10000 - Math.min(2000, Math.max(0, discountBps)))) / 10000,
    ),
    floorPrice(cost, marginBps),
  );
}
@Injectable()
export class Shop {
  constructor(@Inject(Db) readonly db: Db) {}
  async catalog() {
    const rows = await this.db.product.findMany({
      where: { active: true },
      orderBy: [{ category: "asc" }, { priceCents: "asc" }],
    });
    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      description: p.description,
      priceCents: p.priceCents,
      available: p.stock - p.reserved,
    }));
  }
  async lock(tx: Prisma.TransactionClient, sid: string) {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM "Session" WHERE id=${sid} FOR UPDATE`;
    if (!rows.length) throw new NotFoundException();
  }
  async state(sid: string) {
    const s = await this.db.session.findUniqueOrThrow({
      where: { id: sid },
      include: {
        items: { include: { product: true }, orderBy: { productId: "asc" } },
        messages: { orderBy: { createdAt: "desc" }, take: 60 },
        offers: { orderBy: { createdAt: "desc" }, take: 1 },
        reservations: {
          where: { status: { not: "ACTIVE" } },
          orderBy: { createdAt: "desc" },
          take: 30,
        },
      },
    });
    const active = await this.db.reservation.findMany({
      where: { sessionId: sid, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
    });
    // O histórico pode ser limitado; nenhuma reserva ativa pode perder seu botão
    // de cancelamento. Uma transição concorrente não deve duplicar a reserva.
    const reservations = [
      ...new Map([...active, ...s.reservations].map((r) => [r.id, r])).values(),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const offer = s.offers[0];
    return {
      cartVersion: s.cartVersion,
      cart: s.items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
        name: i.product.name,
        unitCents: i.product.priceCents,
        available: i.product.stock - i.product.reserved,
      })),
      messages: s.messages
        .reverse()
        .map((m) => ({ id: m.id, role: m.role, content: m.content })),
      offer:
        offer &&
        offer.cartVersion === s.cartVersion &&
        offer.expiresAt > new Date()
          ? offer
          : null,
      reservations: reservations.map((r) => ({
        ...r,
        requestKey: undefined,
        sessionId: undefined,
        status:
          r.status === "ACTIVE" && r.expiresAt <= new Date()
            ? "EXPIRED"
            : r.status,
      })),
      aiMode: process.env.AI_MODE || "bedrock",
    };
  }
  async setCart(
    sid: string,
    lines: { productId: string; quantity: number }[],
    internal = false,
  ) {
    if (new Set(lines.map((l) => l.productId)).size !== lines.length)
      throw new BadRequestException("Produtos repetidos no carrinho.");
    return this.db.$transaction(async (tx) => {
      await this.lock(tx, sid);
      const s = await tx.session.findUniqueOrThrow({ where: { id: sid } });
      if (!internal && s.chatLeaseUntil && s.chatLeaseUntil > new Date())
        throw new ConflictException("Aguarde o atendimento terminar.");
      const products = await tx.product.findMany({
        where: { id: { in: lines.map((l) => l.productId) }, active: true },
      });
      if (products.length !== lines.length)
        throw new BadRequestException("Produto inválido.");
      await tx.cartItem.deleteMany({ where: { sessionId: sid } });
      if (lines.length)
        await tx.cartItem.createMany({
          data: lines.map((l) => ({ ...l, sessionId: sid })),
        });
      await tx.session.update({
        where: { id: sid },
        data: { cartVersion: { increment: 1 }, negotiationRound: 0 },
      });
    });
  }
  async offer(sid: string, negotiate = false, requestedPercent = 0) {
    return this.db.$transaction(async (tx) => {
      await this.lock(tx, sid);
      const s = await tx.session.findUniqueOrThrow({
        where: { id: sid },
        include: {
          items: { include: { product: true }, orderBy: { productId: "asc" } },
        },
      });
      if (!s.items.length)
        throw new BadRequestException("Escolha pelo menos um produto.");
      const previous = await tx.offer.findFirst({
        where: { sessionId: sid, cartVersion: s.cartVersion },
        orderBy: { createdAt: "desc" },
      });
      if (!negotiate && previous) {
        if (previous.expiresAt <= new Date())
          throw new ConflictException(
            "A oferta venceu. Solicite uma nova negociação.",
          );
        return previous;
      }
      const round = negotiate ? s.negotiationRound + 1 : 0;
      // A IA interpreta a objeção; o backend limita cada concessão. Nunca aceitar o pedido automaticamente.
      const requestedBps = Math.min(
        10000,
        Math.max(0, Math.round(requestedPercent * 100)),
      );
      const target = negotiate
        ? Math.min(2000, round * 300, Math.max(0, requestedBps - 100))
        : 0;
      const discountBps = Math.max(
        previous && previous.expiresAt > new Date() ? previous.discountBps : 0,
        target,
      );
      const lines: Line[] = s.items.map((i) => ({
        productId: i.productId,
        name: i.product.name,
        quantity: i.quantity,
        listUnitCents: i.product.priceCents,
        unitCents: unitPrice(
          i.product.priceCents,
          i.product.costCents,
          i.product.minMarginBps,
          discountBps,
        ),
      }));
      if (negotiate)
        await tx.session.update({
          where: { id: sid },
          data: { negotiationRound: round },
        });
      if (
        previous &&
        previous.expiresAt > new Date() &&
        previous.discountBps === discountBps
      )
        return previous;
      return tx.offer.create({
        data: {
          sessionId: sid,
          cartVersion: s.cartVersion,
          lines: json(lines),
          totalCents: lines.reduce((a, l) => a + l.quantity * l.unitCents, 0),
          discountBps,
          expiresAt: new Date(Date.now() + 600000),
        },
      });
    });
  }
  async confirm(
    sid: string,
    offerId: string,
    name: string,
    requestKey: string,
  ) {
    const result = await this.db.$transaction(
      async (tx) => {
        await this.lock(tx, sid);
        const duplicate = await tx.reservation.findFirst({
          where: { sessionId: sid, OR: [{ requestKey }, { offerId }] },
        });
        if (duplicate) {
          if (duplicate.offerId !== offerId)
            throw new ConflictException("Chave de confirmação já utilizada.");
          return { reservation: duplicate, replayed: true };
        }
        const failed = await tx.dependency.findUnique({
          where: { name: "ai" },
        });
        if (failed?.failedUntil && failed.failedUntil > new Date())
          throw new ServiceUnavailableException(
            "O atendimento está temporariamente indisponível.",
          );
        const overdue = await tx.reservation.findFirst({
          where: {
            status: "ACTIVE",
            expiresAt: { lt: new Date(Date.now() - 30000) },
          },
        });
        if (overdue)
          throw new ServiceUnavailableException(
            "Estamos concluindo reservas anteriores. Tente novamente em instantes.",
          );
        const offer = await tx.offer.findFirst({
          where: { id: offerId, sessionId: sid },
        });
        const session = await tx.session.findUniqueOrThrow({
          where: { id: sid },
        });
        if (
          !offer ||
          offer.expiresAt <= new Date() ||
          offer.cartVersion !== session.cartVersion
        )
          throw new ConflictException(
            "O resumo mudou ou venceu. Solicite uma oferta atualizada.",
          );
        const lines = offer.lines as Line[];
        const ids = lines.map((l) => l.productId).sort();
        const products = await tx.$queryRaw<
          { id: string; stock: number; reserved: number; active: boolean }[]
        >(
          Prisma.sql`SELECT id,stock,reserved,active FROM "Product" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`,
        );
        const shortages = lines.filter((l) => {
          const p = products.find((p) => p.id === l.productId);
          return !p || !p.active || p.stock - p.reserved < l.quantity;
        });
        if (shortages.length) {
          const adjusted = lines
            .map((l) => {
              const p = products.find((p) => p.id === l.productId);
              return {
                productId: l.productId,
                quantity: p?.active
                  ? Math.min(l.quantity, p.stock - p.reserved)
                  : 0,
              };
            })
            .filter((l) => l.quantity > 0);
          await tx.cartItem.deleteMany({ where: { sessionId: sid } });
          if (adjusted.length)
            await tx.cartItem.createMany({
              data: adjusted.map((l) => ({ ...l, sessionId: sid })),
            });
          await tx.session.update({
            where: { id: sid },
            data: { cartVersion: { increment: 1 }, negotiationRound: 0 },
          });
          return { conflict: true };
        }
        for (const line of lines)
          await tx.product.update({
            where: { id: line.productId },
            data: { reserved: { increment: line.quantity } },
          });
        const reservation = await tx.reservation.create({
          data: {
            sessionId: sid,
            offerId,
            requestKey,
            name,
            lines: json(lines),
            totalCents: offer.totalCents,
            expiresAt: new Date(Date.now() + 900000),
          },
        });
        await tx.outbox.create({
          data: {
            reservationId: reservation.id,
            kind: "EXPIRE_RESERVATION",
            availableAt: reservation.expiresAt,
          },
        });
        await tx.cartItem.deleteMany({ where: { sessionId: sid } });
        await tx.session.update({
          where: { id: sid },
          data: { cartVersion: { increment: 1 }, negotiationRound: 0 },
        });
        return { reservation, replayed: false };
      },
      { timeout: 10000 },
    );
    if (result.conflict) {
      if (await this.db.cartItem.count({ where: { sessionId: sid } }))
        await this.offer(sid);
      metric("StockConflicts", 1);
      throw new ConflictException({
        message:
          "O estoque mudou. Confira o carrinho atualizado e solicite um novo resumo antes de confirmar.",
        code: "STOCK_CHANGED",
      });
    }
    if (!result.replayed) metric("ReservationsConfirmed", 1);
    log(result.replayed ? "reservation.replayed" : "reservation.confirmed", {
      reservationId: result.reservation!.id,
    });
    return result.reservation!;
  }
  async finish(
    id: string,
    status: "EXPIRED" | "CANCELLED",
    sid?: string,
    eventId?: string,
  ) {
    const changed = await this.db.$transaction(async (tx) => {
      let change:
        { status: "EXPIRED" | "CANCELLED"; expiresAt: Date } | undefined;
      // Mesmo bloqueio para cancelamento, recuperação e eventos duplicados.
      const rows = await tx.$queryRaw<
        {
          id: string;
          sessionId: string;
          status: string;
          lines: unknown;
          expiresAt: Date;
        }[]
      >`SELECT * FROM "Reservation" WHERE id=${id} FOR UPDATE`;
      const r = rows[0];
      if (!r || (sid && r.sessionId !== sid))
        throw new NotFoundException("Reserva não encontrada.");
      if (
        eventId &&
        (await tx.processedEvent.findUnique({ where: { id: eventId } }))
      )
        return;
      if (status === "EXPIRED" && r.expiresAt > new Date())
        throw new BadRequestException("Evento recebido antes do vencimento.");
      if (r.status === "ACTIVE") {
        const actualStatus = r.expiresAt <= new Date() ? "EXPIRED" : status;
        for (const l of (r.lines as Line[])
          .slice()
          .sort((a, b) => a.productId.localeCompare(b.productId)))
          await tx.product.update({
            where: { id: l.productId },
            data: { reserved: { decrement: l.quantity } },
          });
        await tx.reservation.update({
          where: { id },
          data: { status: actualStatus, endedAt: new Date() },
        });
        change = { status: actualStatus, expiresAt: r.expiresAt };
      }
      if (eventId) await tx.processedEvent.create({ data: { id: eventId } });
      return change;
    });
    if (changed) {
      metric(
        changed.status === "EXPIRED"
          ? "ReservationsExpired"
          : "ReservationsCancelled",
        1,
      );
      if (changed.status === "EXPIRED")
        metric(
          "ExpirationLag",
          Math.max(0, (Date.now() - changed.expiresAt.getTime()) / 1000),
          "Seconds",
        );
      log("reservation.ended", {
        reservationId: id,
        status: changed.status,
        eventId,
      });
    }
  }
}
