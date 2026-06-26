import { Construction } from "lucide-react";

export default function ComingSoon({ title, description }) {
  return (
    <div className="mx-auto max-w-7xl px-5 py-7">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      <div className="mt-6 flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-20 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-500">
          <Construction className="h-6 w-6" />
        </span>
        <p className="mt-4 text-base font-semibold text-slate-800">Coming soon</p>
        <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>
      </div>
    </div>
  );
}
