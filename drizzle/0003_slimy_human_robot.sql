ALTER TABLE "barcodes" ADD COLUMN "full_product_name" varchar(500);--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "barcode" varchar(255);--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "was_scanned" boolean DEFAULT false;