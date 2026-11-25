// All currency is represented as integer minor units.
export function lineTotal(price, quantity) {
  if (!Number.isSafeInteger(price) || price < 0 || !Number.isSafeInteger(quantity) || quantity < 0) throw new TypeError('Invalid money or quantity');
  const total = price * quantity;
  if (!Number.isSafeInteger(total)) throw new RangeError('Overflow');
  return total;
}
