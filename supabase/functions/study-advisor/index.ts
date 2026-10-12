import { createClient } from "npm:@supabase/supabase-js@2.110.2";
import { createAdvisorHandler } from "./handler.ts";
import catalog from "./catalog.json" with { type: "json" };

Deno.serve(
  createAdvisorHandler({
    createClient,
    catalog,
    env: (name: string) => Deno.env.get(name),
    fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
  }),
);

