import { NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabase';

export async function DELETE(_: Request, { params }: { params: { id: string, itemId: string } }) {
  const supabase = createSupabaseServer();
  const { error } = await supabase.from('playlist_items').delete()
    .eq('id', params.itemId).eq('playlist_id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
