BEGIN;

ALTER TABLE recipe_quotes
  ADD COLUMN source_order_id uuid,
  ADD FOREIGN KEY (source_order_id, user_id) REFERENCES recipe_orders(id, user_id),
  ADD CHECK (source_order_id IS NULL OR access = 'premium');

COMMIT;
