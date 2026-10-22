// Small shared pieces: cards, tables, number formats and the CSV download helper.

export const r1 = (n: number) => Math.round(n * 10) / 10;
export const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function Card(props: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-zinc-300 bg-white p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">{props.title}</h2>
        {props.action}
      </div>
      {props.children}
    </section>
  );
}

export function Table(props: { head: { label: string; num?: boolean }[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm tabular-nums">
        <thead>
          <tr>
            {props.head.map((h, i) => (
              <th key={i} className={`border-b border-zinc-300 px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-600 ${h.num ? "text-right" : "text-left"}`}>
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} className={`whitespace-nowrap border-b border-zinc-200 px-2 py-1.5 ${props.head[j].num ? "text-right" : "text-left"}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const inputClass = "rounded-md border border-zinc-300 bg-zinc-50 p-2";
export const primaryButton =
  "rounded-md bg-brand px-4 py-2 font-semibold text-white hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";
