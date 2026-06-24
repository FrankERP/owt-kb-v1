export function slugifyAuthor(name) {
  return (name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")   // strip combining marks: á -> a (explicit codepoints, copy-safe)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")       // any run of non-alphanumerics -> one dash
    .replace(/^-+|-+$/g, "")           // trim edge dashes
    .slice(0, 96);
}
