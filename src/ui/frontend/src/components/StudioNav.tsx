import { NavLink } from "react-router-dom";

interface Item {
  to: string;
  label: string;
  icon: string;
}

const items: Item[] = [
  {
    to: "/hitl",
    label: "HITL",
    icon: "M12 9v2m0 4h.01m-7.3 4h14.6c1.5 0 2.5-1.6 1.7-2.9L13.7 4c-.8-1.4-2.8-1.4-3.6 0L3 16.1c-.8 1.3.2 2.9 1.7 2.9z",
  },
  {
    to: "/workflow",
    label: "Workflow",
    icon: "M4 6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM14 6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2zM4 16a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM14 16a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2z",
  },
  {
    to: "/trace",
    label: "Trace",
    icon: "M9 17h6M9 13h6M9 9h2m7 10H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h8l6 6v6a2 2 0 0 1-2 2z",
  },
  {
    to: "/registry",
    label: "Registry",
    icon: "M12 8c-4 0-7 1.8-7 4s3 4 7 4 7-1.8 7-4-3-4-7-4zm0 0V5m0 11v3",
  },
];

export function StudioNav() {
  return (
    <aside className="z-10 hidden w-24 flex-col items-center gap-4 border-r border-slate-200 bg-white/80 py-5 backdrop-blur lg:flex">
      <div className="mb-2 grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-[#38a169] to-[#0d652d] text-lg font-bold text-white shadow-lg shadow-[#0d652d]/25">
        O
      </div>

      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            `flex w-20 flex-col items-center gap-1 rounded-xl border px-2 py-2 text-[11px] transition ${
              isActive
                ? "border-[#bad5c3] bg-[#e6f4ea] text-[#0d652d]"
                : "border-transparent text-slate-500 hover:border-[#bad5c3] hover:bg-[#e6f4ea] hover:text-[#0d652d]"
            }`
          }
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d={item.icon} />
          </svg>
          <span>{item.label}</span>
        </NavLink>
      ))}
    </aside>
  );
}
