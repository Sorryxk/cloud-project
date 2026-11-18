# Guardrails HTTP — produção Ohio, 18/11/2026

**Resultado: 8/8 negativos aprovados; cinco invariantes preservados.** Evidência: [guardrails-http.json](/Users/soria/Documents/Codex/2026-11-12/c/outputs/periferia/docs/evidence/manual-validation-20261118/guardrails-http.json).

O script foi preparado por este agente e executado pelo agente principal, pois a primeira tentativa neste agente foi bloqueada por resolução DNS do sandbox. Conferi diretamente o JSON da execução concluída, entre 08:56:43 e 08:56:53, horário de Brasília. Foram 16 requisições em baixo volume, incluindo preparação e leituras, com duas sessões próprias. Cookies ficaram apenas em memória; não foram lidos segredos, criadas reservas ou alterados recursos, políticas e contagens da AWS.

| Negativo | Esperado | Observado |
| --- | ---: | ---: |
| Estado sem cookie | 401 | 401 |
| Mutação sem Origin e sem cabeçalho obrigatório do cliente | 403 | 403 |
| Origem externa, mesmo com cookie próprio e cabeçalho do cliente | 403 | 403 |
| Quantidade zero | 400 | 400 |
| Campo de preço extra injetado no carrinho | 400 | 400 |
| Confirmação com `confirmed:false` | 400 | 400 |
| Cookie fabricado | 401 | 401 |
| JSON malformado | 400 | 400 |

As leituras anteriores e posteriores confirmaram carrinhos e reservas inalterados nas duas sessões, além da disponibilidade pública de estoque inalterada.

## Fontes conferidas

- Sessão e autenticação: [security.ts:45](/Users/soria/Documents/Codex/2026-11-12/c/outputs/periferia/src/server/security.ts:45).
- Origem e cabeçalho obrigatório de mutação: [security.ts:33](/Users/soria/Documents/Codex/2026-11-12/c/outputs/periferia/src/server/security.ts:33). A ausência de Origin, isoladamente, não é rejeitada pelo contrato; o teste omitiu também o cabeçalho obrigatório.
- Quantidades positivas e campos estritos: [http.ts:22](/Users/soria/Documents/Codex/2026-11-12/c/outputs/periferia/src/server/http.ts:22).
- Consentimento literal verdadeiro: [http.ts:91](/Users/soria/Documents/Codex/2026-11-12/c/outputs/periferia/src/server/http.ts:91).
- Conversão de erros de validação para HTTP 400: [http.ts:177](/Users/soria/Documents/Codex/2026-11-12/c/outputs/periferia/src/server/http.ts:177).
- Parser JSON antes do middleware de correlação: [main.ts:44](/Users/soria/Documents/Codex/2026-11-12/c/outputs/periferia/src/server/main.ts:44).

## Limites

Não foram exercitados acesso a uma reserva existente de outra sessão, métodos HTTP inválidos, limite por exaustão, carga, failover ou negociação com IA. O cookie fabricado testa autenticação inválida, não acesso indevido a um objeto real de outro visitante. O ensaio não demonstra ausência de jailbreak.

O JSON malformado foi corretamente rejeitado com 400, mas sua resposta não trouxe `X-Request-Id`; isso limita a correlação desse tipo de erro. Não houve correção de aplicação ou implantação por este agente.
