-- Stock moved to inventory-service (its own database, inventory_db).
ALTER TABLE "products" DROP COLUMN "stock";
