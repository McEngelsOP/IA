import { createClient } from 'npm:@supabase/supabase-js@2.110.2';
import { createCurriculumHandler } from './handler.ts';
Deno.serve(createCurriculumHandler({createClient,env:name=>Deno.env.get(name)}));
