-- Executar uma vez com a credencial de migração, na rede privada.
-- Senhas são definidas via fluxo seguro e guardadas no Secrets Manager; não colocar aqui.
CREATE ROLE periferia_api LOGIN;
CREATE ROLE periferia_worker LOGIN;
GRANT CONNECT ON DATABASE periferia TO periferia_api, periferia_worker;
GRANT USAGE ON SCHEMA public TO periferia_api, periferia_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON "Session", "CartItem", "Message", "Offer", "Reservation", "Outbox", "RateBucket", "Dependency" TO periferia_api;
GRANT SELECT ON "Product" TO periferia_api;
GRANT UPDATE (reserved) ON "Product" TO periferia_api;
GRANT SELECT, UPDATE ON "Reservation", "Outbox" TO periferia_worker;
GRANT SELECT ON "Product" TO periferia_worker;
GRANT UPDATE (reserved) ON "Product" TO periferia_worker;
GRANT SELECT, INSERT ON "ProcessedEvent" TO periferia_worker;
GRANT SELECT, DELETE ON "RateBucket" TO periferia_worker;
-- Nenhum destes usuários deve ser proprietário das tabelas ou executar migrations.
