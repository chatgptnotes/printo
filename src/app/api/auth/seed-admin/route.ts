import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/storage/supabase';
import bcrypt from 'bcryptjs';

// Seed admin account if it doesn't exist — disabled in production
export async function POST() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available' }, { status: 404 });
  }

  try {
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@sabi.ae';
    const adminPassword = process.env.ADMIN_PASSWORD || 'sabi2024';

    // Check if admin exists
    const { data: existing } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', adminEmail)
      .single();

    if (existing) {
      return NextResponse.json({ message: 'Admin account already exists', email: adminEmail });
    }

    // Create admin
    const hashedPassword = await bcrypt.hash(adminPassword, 10);
    const { error } = await supabaseAdmin
      .from('users')
      .insert({
        email: adminEmail,
        password: hashedPassword,
        full_name: 'ERP Realsoft Admin',
      });

    if (error) throw error;

    return NextResponse.json({ message: 'Admin account created', email: adminEmail });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to seed admin', details: error.message },
      { status: 500 }
    );
  }
}
