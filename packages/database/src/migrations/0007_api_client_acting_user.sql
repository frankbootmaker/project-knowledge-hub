ALTER TABLE "api_clients" ADD COLUMN "acting_user_id" uuid;--> statement-breakpoint
ALTER TABLE "api_clients" ADD CONSTRAINT "api_clients_acting_user_id_users_id_fk" FOREIGN KEY ("acting_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_clients_acting_user_id_idx" ON "api_clients" USING btree ("acting_user_id");
