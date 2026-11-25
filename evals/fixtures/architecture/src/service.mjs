export function invoiceTotal(items) {
  return items.reduce((sum, item) => sum + item.price, 0);
}
