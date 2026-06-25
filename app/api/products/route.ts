import getDb from '@/lib/db';

export async function GET() {
  const db = getDb();
  const products = db.prepare(`
    SELECT id, name, set_name, product_type
    FROM products
    ORDER BY set_name, product_type
  `).all();
  return Response.json(products);
}
