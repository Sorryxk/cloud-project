import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUp,
  ShoppingBag,
  Keyboard,
  Mouse,
  Headphones,
  Monitor,
  Check,
  Clock,
  Minus,
  Plus,
  X,
  MessageCircle,
  PackageCheck,
  ChevronRight,
  RefreshCw,
} from "lucide-react";
import "./style.css";
type Product = {
  id: string;
  name: string;
  category: string;
  description: string;
  priceCents: number;
  available: number;
};
type CartLine = {
  productId: string;
  name: string;
  quantity: number;
  unitCents: number;
  available: number;
};
type OfferLine = {
  productId: string;
  name: string;
  quantity: number;
  unitCents: number;
  listUnitCents: number;
};
type Offer = {
  id: string;
  lines: OfferLine[];
  totalCents: number;
  expiresAt: string;
};
type Reservation = {
  id: string;
  name: string;
  lines: OfferLine[];
  totalCents: number;
  status: string;
  expiresAt: string;
};
type State = {
  cart: CartLine[];
  messages: { id: string; role: string; content: string }[];
  offer: Offer | null;
  reservations: Reservation[];
  aiMode: string;
};
const money = (v: number) =>
  (v / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const icon = (category: string) =>
  category === "Teclados"
    ? Keyboard
    : category === "Mouses"
      ? Mouse
      : category === "Headsets"
        ? Headphones
        : Monitor;
async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch("/api/" + path, {
    method,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-Periferia-Client": "web",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok)
    throw Error(data.message || "Não foi possível concluir. Tente novamente.");
  return data;
}
function Countdown({ until }: { until: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const secs = Math.max(0, Math.ceil((Date.parse(until) - now) / 1000));
  return (
    <>
      {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}
    </>
  );
}
function App() {
  const [state, setState] = useState<State | null>(null),
    [products, setProducts] = useState<Product[]>([]),
    [category, setCategory] = useState("Todos"),
    [tab, setTab] = useState<"catalog" | "reservations">("catalog"),
    [text, setText] = useState(""),
    [pending, setPending] = useState(""),
    [stream, setStream] = useState(""),
    [chatting, setChatting] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [name, setName] = useState(""),
    [cancel, setCancel] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  async function refresh() {
    const [s, p] = await Promise.all([
      api<State>("state"),
      api<Product[]>("catalog"),
    ]);
    setState(s);
    setProducts(p);
  }
  useEffect(() => {
    api<State>("session")
      .then(async (s) => {
        setState(s);
        setProducts(await api<Product[]>("catalog"));
      })
      .catch((e) => setError(e.message));
    const t = setInterval(() => {
      refresh().catch(() => {});
    }, 15000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [stream, state?.messages.length]);
  async function mutate(path: string, method = "POST", body?: unknown) {
    setBusy(true);
    setError("");
    try {
      setState(await api<State>(path, method, body));
      setProducts(await api<Product[]>("catalog"));
      return true;
    } catch (e) {
      setError((e as Error).message);
      await refresh().catch(() => {});
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function quantity(productId: string, quantity: number) {
    if (!state) return;
    const items = state.cart
      .filter((l) => l.productId !== productId)
      .map(({ productId, quantity }) => ({ productId, quantity }));
    if (quantity > 0) items.push({ productId, quantity });
    await mutate("cart", "PUT", { items });
  }
  async function send(event?: React.FormEvent, quick?: string) {
    event?.preventDefault();
    const message = (quick || text).trim();
    if (!message || chatting || busy) return;
    setText("");
    setError("");
    setPending(message);
    setStream("");
    setChatting(true);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-Periferia-Client": "web",
        },
        body: JSON.stringify({ message }),
      });
      if (!response.ok) {
        const body = await response.json();
        throw Error(body.message || "Atendimento indisponível.");
      }
      if (!response.body) throw Error("Resposta interrompida.");
      const reader = response.body.getReader(),
        decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let split;
        while ((split = buffer.indexOf("\n\n")) >= 0) {
          const packet = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          const event = packet
            .split("\n")
            .find((l) => l.startsWith("event: "))
            ?.slice(7);
          const data = packet
            .split("\n")
            .filter((l) => l.startsWith("data: "))
            .map((l) => l.slice(6))
            .join("\n");
          if (!data) continue;
          const parsed = JSON.parse(data);
          if (event === "delta") setStream((t) => t + parsed.text);
          if (event === "state") setState(parsed);
          if (event === "failure") setError(parsed.message);
        }
      }
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      await refresh().catch(() => {});
    } finally {
      setPending("");
      setStream("");
      setChatting(false);
    }
  }
  async function confirm() {
    if (!state?.offer || !name.trim()) return;
    const offerId = state.offer.id;
    const success = await mutate("reservations", "POST", {
      offerId,
      name: name.trim(),
      requestKey: offerId,
      confirmed: true,
    });
    if (success) setTab("reservations");
  }
  const disabled = busy || chatting;
  const itemCount =
    state?.cart.reduce((sum, line) => sum + line.quantity, 0) || 0;
  return (
    <>
      <header>
        <a className="brand" href="/" aria-label="Periferia, início">
          <span className="brand-mark">
            <Keyboard size={24} />
          </span>
          periferia<span className="brand-dot">.</span>
        </a>
        <span className="header-note">Bons equipamentos. Boa conversa.</span>
        <button
          className="reservations-link"
          onClick={() => setTab("reservations")}
        >
          <ShoppingBag size={17} />
          Minhas reservas{" "}
          <span>
            {state?.reservations.filter((r) => r.status === "ACTIVE").length ||
              0}
          </span>
        </button>
      </header>
      <main>
        <div className="page-heading">
          <div>
            <p className="intro">Um setup que faz sentido para você</p>
            <h1>
              Escolha na conversa.
              <br />
              Reserve com confiança.
            </h1>
          </div>
          <p className="heading-note">
            Conte o que você precisa.
            <br />A gente encontra o periférico certo.
          </p>
        </div>
        {state?.aiMode === "mock" && (
          <div className="mock-notice">
            <span />
            Demonstração local: atendimento simulado. A integração com Luna
            ainda não está habilitada.
          </div>
        )}
        {error && (
          <div className="error" role="alert">
            <span>{error}</span>
            <button onClick={() => setError("")} aria-label="Fechar aviso">
              <X size={17} />
            </button>
          </div>
        )}
        <div className="workspace">
          <section className="chat-panel" aria-label="Atendimento">
            <div className="panel-title">
              <div className="advisor-avatar">
                <MessageCircle size={20} />
              </div>
              <div>
                <h2>Vamos montar seu setup?</h2>
                <p>Atendimento Periferia</p>
              </div>
              <span className="conversation-label">Conversa</span>
            </div>
            <div className="messages" aria-live="polite">
              <div className="message assistant">
                <span className="message-label">Periferia</span>
                <p>
                  Olá! O que vai fazer parte do seu próximo setup? Me conte como
                  você usa o computador e quanto pretende investir.
                </p>
              </div>
              {!state?.messages.length && !pending && (
                <div className="quick-prompts">
                  {[
                    "Um teclado para trabalhar",
                    "Um mouse para jogar",
                    "Quero melhorar meu áudio",
                  ].map((q) => (
                    <button
                      key={q}
                      onClick={() => send(undefined, q)}
                      disabled={disabled}
                    >
                      {q}
                      <ChevronRight size={15} />
                    </button>
                  ))}
                </div>
              )}
              {state?.messages.map((m) => (
                <div key={m.id} className={"message " + m.role}>
                  <span className="message-label">
                    {m.role === "user" ? "Você" : "Periferia"}
                  </span>
                  <p>{m.content}</p>
                </div>
              ))}
              {chatting &&
                pending &&
                !state?.messages.some(
                  (m) => m.role === "user" && m.content === pending,
                ) && (
                  <div className="message user">
                    <span className="message-label">Você</span>
                    <p>{pending}</p>
                  </div>
                )}
              {chatting && (
                <div className="message assistant">
                  <span className="message-label">Periferia</span>
                  <p>{stream || "Preparando sua resposta…"}</p>
                </div>
              )}
              <div ref={end} />
            </div>
            <form className="composer" onSubmit={send}>
              <label className="sr-only" htmlFor="message">
                Sua mensagem
              </label>
              <textarea
                id="message"
                rows={2}
                maxLength={2000}
                placeholder="Conte seu uso, orçamento ou tire uma dúvida…"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
              />
              <button
                className="send"
                type="submit"
                disabled={disabled || !text.trim() || !state}
                aria-label="Enviar mensagem"
              >
                <ArrowUp size={20} />
              </button>
              <p>Você sempre confere o resumo antes de reservar.</p>
            </form>
          </section>
          <aside className="shop-panel">
            <div className="tabs">
              <button
                className={tab === "catalog" ? "active" : ""}
                onClick={() => setTab("catalog")}
              >
                Explore os produtos
              </button>
              <button
                className={tab === "reservations" ? "active" : ""}
                onClick={() => setTab("reservations")}
              >
                Suas reservas
              </button>
            </div>
            {tab === "catalog" ? (
              <>
                <nav className="categories" aria-label="Categorias">
                  {["Todos", "Teclados", "Mouses", "Headsets", "Monitores"].map(
                    (c) => (
                      <button
                        key={c}
                        className={category === c ? "selected" : ""}
                        onClick={() => setCategory(c)}
                      >
                        {c}
                      </button>
                    ),
                  )}
                </nav>
                <div className="catalog">
                  {products
                    .filter(
                      (p) => category === "Todos" || p.category === category,
                    )
                    .map((p) => {
                      const Icon = icon(p.category),
                        inCart =
                          state?.cart.find((l) => l.productId === p.id)
                            ?.quantity || 0;
                      return (
                        <article className="product" key={p.id}>
                          <div className={"product-visual " + p.category}>
                            <Icon strokeWidth={1.25} size={57} />
                            <span>
                              {{
                                Teclados: "Teclado",
                                Mouses: "Mouse",
                                Headsets: "Headset",
                                Monitores: "Monitor",
                              }[p.category] || p.category}
                            </span>
                          </div>
                          <div className="product-info">
                            <h3>{p.name}</h3>
                            <p>{p.description}</p>
                            <div className="product-bottom">
                              <strong>{money(p.priceCents)}</strong>
                              <button
                                disabled={
                                  disabled || !state || p.available === 0
                                }
                                onClick={() => quantity(p.id, inCart + 1)}
                                aria-label={"Adicionar " + p.name}
                              >
                                <Plus size={17} />
                              </button>
                            </div>
                            <small>
                              {p.available > 0
                                ? `${p.available} ${p.available === 1 ? "disponível" : "disponíveis"}`
                                : "Indisponível"}
                            </small>
                          </div>
                        </article>
                      );
                    })}
                </div>
                <div className="cart">
                  <div className="cart-title">
                    <h2>
                      <ShoppingBag size={18} />
                      Seu carrinho
                    </h2>
                    <span>
                      {itemCount} {itemCount === 1 ? "item" : "itens"}
                    </span>
                  </div>
                  {!state?.cart.length ? (
                    <p className="empty-cart">
                      Escolha um produto ou peça uma recomendação na conversa.
                    </p>
                  ) : (
                    <>
                      {state.cart.map((l) => (
                        <div className="cart-line" key={l.productId}>
                          <div>
                            <strong>{l.name}</strong>
                            <span>{money(l.unitCents)} por unidade</span>
                          </div>
                          <div className="quantity">
                            <button
                              disabled={disabled}
                              onClick={() =>
                                quantity(l.productId, l.quantity - 1)
                              }
                              aria-label={"Diminuir " + l.name}
                            >
                              <Minus size={13} />
                            </button>
                            <span>{l.quantity}</span>
                            <button
                              disabled={disabled}
                              onClick={() =>
                                quantity(l.productId, l.quantity + 1)
                              }
                              aria-label={"Aumentar " + l.name}
                            >
                              <Plus size={13} />
                            </button>
                          </div>
                        </div>
                      ))}
                      <button
                        className="primary full"
                        disabled={disabled}
                        onClick={() => mutate("offers")}
                      >
                        Conferir resumo da reserva
                        <ChevronRight size={17} />
                      </button>
                    </>
                  )}
                </div>
                {state?.offer && (
                  <section className="offer" aria-label="Resumo da reserva">
                    <div className="offer-heading">
                      <h2>Confira antes de reservar</h2>
                      <span>
                        <Clock size={14} />
                        <Countdown until={state.offer.expiresAt} />
                      </span>
                    </div>
                    {state.offer.lines.map((l) => (
                      <div className="offer-line" key={l.productId}>
                        <span>
                          {l.quantity} × {l.name}
                        </span>
                        <strong>{money(l.unitCents * l.quantity)}</strong>
                      </div>
                    ))}
                    <div className="offer-total">
                      <span>Total da reserva</span>
                      <strong>{money(state.offer.totalCents)}</strong>
                    </div>
                    <label htmlFor="name">Como podemos chamar você?</label>
                    <input
                      id="name"
                      autoComplete="given-name"
                      maxLength={80}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Seu nome"
                    />
                    <p>
                      O estoque será reservado por 15 minutos após a
                      confirmação. Sem pagamento nesta demonstração.
                    </p>
                    <button
                      className="primary full"
                      disabled={
                        disabled ||
                        !name.trim() ||
                        Date.parse(state.offer.expiresAt) <= Date.now()
                      }
                      onClick={confirm}
                    >
                      <Check size={17} />
                      Confirmar reserva
                    </button>
                  </section>
                )}
              </>
            ) : (
              <div className="reservation-list">
                {!state?.reservations.length ? (
                  <div className="empty-reservations">
                    <PackageCheck size={44} strokeWidth={1} />
                    <h2>Seu próximo setup começa aqui.</h2>
                    <p>
                      Depois de confirmar o resumo, suas reservas aparecem neste
                      espaço.
                    </p>
                    <button onClick={() => setTab("catalog")}>
                      Explorar produtos
                    </button>
                  </div>
                ) : (
                  state.reservations.map((r) => (
                    <article className="reservation" key={r.id}>
                      <div className="reservation-top">
                        <span className={"status " + r.status}>
                          {r.status === "ACTIVE"
                            ? "Reservado"
                            : r.status === "CANCELLED"
                              ? "Cancelado"
                              : "Expirado"}
                        </span>
                        <span>#{r.id.slice(0, 8)}</span>
                      </div>
                      <h3>Reserva de {r.name}</h3>
                      {r.lines.map((l) => (
                        <div className="offer-line" key={l.productId}>
                          <span>
                            {l.quantity} × {l.name}
                          </span>
                          <strong>{money(l.quantity * l.unitCents)}</strong>
                        </div>
                      ))}
                      <div className="offer-total">
                        <span>Total</span>
                        <strong>{money(r.totalCents)}</strong>
                      </div>
                      {r.status === "ACTIVE" && (
                        <>
                          <p className="reservation-clock">
                            <Clock size={15} />
                            Expira em <Countdown until={r.expiresAt} />
                          </p>
                          {cancel === r.id ? (
                            <div className="cancel-confirm">
                              <p>Cancelar e liberar todos os itens?</p>
                              <button
                                className="danger"
                                disabled={busy}
                                onClick={async () => {
                                  await mutate(
                                    `reservations/${r.id}/cancel`,
                                    "POST",
                                    { confirmed: true },
                                  );
                                  setCancel(null);
                                }}
                              >
                                Sim, cancelar reserva
                              </button>
                              <button onClick={() => setCancel(null)}>
                                Manter reserva
                              </button>
                            </div>
                          ) : (
                            <button
                              className="cancel-link"
                              onClick={() => setCancel(r.id)}
                            >
                              Cancelar reserva
                            </button>
                          )}
                        </>
                      )}
                    </article>
                  ))
                )}
              </div>
            )}
          </aside>
        </div>
        <footer>
          <span>Periferia. Equipamentos para o seu jeito de usar.</span>
          <button onClick={() => refresh().catch((e) => setError(e.message))}>
            <RefreshCw size={13} />
            Atualizar disponibilidade
          </button>
        </footer>
      </main>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
