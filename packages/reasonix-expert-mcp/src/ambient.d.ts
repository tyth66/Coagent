// Ambient type declarations for Bun/Node cross-runtime compatibility.

// import.meta.main (supported by both Bun and Node 22+ ESM)
interface ImportMeta {
  readonly main?: boolean;
  readonly dir?: string;
}
