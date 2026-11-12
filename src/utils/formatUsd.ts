/**
 * Format a USD amount so sub-micro-dollar values stay readable.
 * Embeddings calls cost on the order of $1e-8, which `toFixed(6)` renders as
 * "0.000000" and `String()` renders as "8e-9".
 */
export function formatUsd(amount: number): string {
	if (!Number.isFinite(amount)) return `$${amount}`;
	if (amount === 0) return "$0";
	const magnitude = Math.floor(Math.log10(Math.abs(amount)));
	const digits = Math.min(20, Math.max(6, 2 - magnitude));
	const fixed = amount.toFixed(digits).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
	return `$${fixed}`;
}
