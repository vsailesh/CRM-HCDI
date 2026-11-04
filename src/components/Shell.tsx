"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  LayoutDashboard, Inbox, Users,
  MessageCircle, MapPin, QrCode, ChevronDown, Coins, Bell, RefreshCw, PanelLeft, LogOut,
  Home, LifeBuoy, Contact, Building2, BookOpen, BarChart3, MessagesSquare, Paperclip, ClipboardCheck,
  Stethoscope, Handshake, PhoneCall, Box,
  type LucideIcon,
} from "lucide-react";

type NavLink = { href: string; label: string; icon: LucideIcon };
type NavPlain = { label: string; icon: LucideIcon };
type NavExpand = { label: string; icon: LucideIcon; children: Array<{ href: string; label: string }> };
type NavItem = NavLink | NavPlain | NavExpand;
const WORKSPACE: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Workspace",
    items: [
      { href: "/home", label: "Home", icon: Home },
      { href: "/o/case", label: "Cases", icon: LifeBuoy },
      { href: "/o/contact", label: "Contacts", icon: Contact },
      { href: "/o/account", label: "Accounts", icon: Building2 },
      { href: "/o/knowledge", label: "Knowledge", icon: BookOpen },
      { href: "/reports", label: "Reports", icon: BarChart3 },
      { href: "/dashboards", label: "Dashboards", icon: LayoutDashboard },
      { href: "/o/chatter", label: "Chatter", icon: MessagesSquare },
      { href: "/o/file", label: "Files", icon: Paperclip },
      { href: "/o/hedis_measure", label: "HEDIS Measures", icon: ClipboardCheck },
      { href: "/o/provider", label: "Providers", icon: Stethoscope },
      { href: "/o/provider_health_plan", label: "Provider Health Plans", icon: Handshake },
      { href: "/o/household", label: "Households", icon: Users },
      { href: "/o/redetermination_call", label: "Redetermination Calls", icon: PhoneCall },
    ],
  },
];
const NAV: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Dashboard",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/inbox", label: "Unified Inbox", icon: Inbox },
      {
        label: "CRM", icon: Users, children: [
          { href: "/crm/customers", label: "Customers" },
          { href: "/crm/pipeline", label: "Pipeline" },
          { href: "/crm/follow-ups", label: "Follow-ups" },
          { href: "/crm/segments", label: "Segments" },
          { href: "/crm/analytics", label: "Analytics" },
          { href: "/staffs", label: "Staff" },
          { href: "/setup/objects", label: "Object Manager" },
          { href: "/setup/automation", label: "Case Automation" },
          { href: "/setup/sharing", label: "Sharing & Access" },
          { href: "/compliance/audit", label: "Audit Log" },
        ],
      },
    ],
  },
  {
    label: "Channels",
    items: [
      {
        label: "WhatsApp", icon: MessageCircle, children: [
          { href: "/channels/whatsapp", label: "Overview" },
          { href: "/channels/whatsapp/templates", label: "Templates" },
          { href: "/channels/whatsapp/campaigns", label: "Campaigns" },
          { href: "/channels/whatsapp/scheduler", label: "Scheduler" },
          { href: "/channels/whatsapp/chatbot", label: "Chatbot" },
          { href: "/channels/whatsapp/settings", label: "Settings" },
        ],
      },
      { href: "/channels/google-my-business", label: "Google My Business", icon: MapPin },
    ],
  },
  {
    label: "Tools",
    items: [{ href: "/tools/qr-studio", label: "QR Studio", icon: QrCode }],
  },
];

/** click-outside close for dropdowns */
function useDismiss(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [onClose]);
  return ref;
}

export function Sidebar() {
  const path = usePathname();
  const router = useRouter();
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({
    CRM: path?.startsWith("/crm") ?? true,
    WhatsApp: path?.startsWith("/channels/whatsapp") ?? true,
  });
  const [collapsed, setCollapsed] = useState(false);
  const [acctOpen, setAcctOpen] = useState(false);
  const [me, setMe] = useState<{ id: string; name: string; role: string } | null>(null);
  const [custom, setCustom] = useState<Array<{ api: string; plural: string }>>([]);
  const acctRef = useDismiss(() => setAcctOpen(false));

  useEffect(() => {
    fetch("/api/auth/me").then((r) => (r.ok ? r.json() : null)).then((j) => setMe(j?.data ?? null)).catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/objects").then((r) => (r.ok ? r.json() : null)).then((j) => setCustom((j?.data ?? []).filter((o: { isSystem: boolean }) => !o.isSystem))).catch(() => {});
  }, [path]);

  const navAll: Array<{ label: string; items: NavItem[] }> = [
    ...WORKSPACE,
    ...(custom.length ? [{ label: "Custom Objects", items: custom.map((o) => ({ href: `/o/${o.api}`, label: o.plural, icon: Box })) as NavItem[] }] : []),
    ...NAV,
  ];

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  const isActive = (href: string) => path === href || (href !== "/" && (path?.startsWith(href + "/") ?? false));
  const itemCls = (active: boolean) =>
    `flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm transition-colors ${
      active ? "bg-lime font-semibold text-forest-950" : "text-white/75 hover:bg-white/5 hover:text-white"
    } ${collapsed ? "justify-center px-2" : ""}`;

  return (
    <aside className={`sticky top-0 flex h-screen shrink-0 flex-col bg-forest-950 text-white transition-[width] ${collapsed ? "w-[76px]" : "w-72"}`}>
      <div className={`flex items-center py-5 ${collapsed ? "justify-center px-2" : "justify-between px-5"}`}>
        <Link href="/dashboard" className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-lg bg-lime text-sm font-black text-forest-950">V</span>
          {!collapsed && <span className="text-lg font-bold tracking-tight">VFV CRM</span>}
        </Link>
        {!collapsed && (
          <button aria-label="Collapse sidebar" onClick={() => setCollapsed(true)}
            className="grid size-8 place-items-center rounded-lg text-white/40 hover:bg-white/10 hover:text-white">
            <PanelLeft className="size-4" />
          </button>
        )}
      </div>
      {collapsed && (
        <button aria-label="Expand sidebar" onClick={() => setCollapsed(false)}
          className="mx-auto mb-2 grid size-8 place-items-center rounded-lg text-white/40 hover:bg-white/10 hover:text-white">
          <PanelLeft className="size-4 rotate-180" />
        </button>
      )}

      <nav className="scroll-thin flex-1 overflow-y-auto px-4">
        {navAll.map((section) => (
          <div key={section.label} className="mt-6 first:mt-1">
            <p className={`mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/40 ${collapsed ? "hidden" : ""}`}>{section.label}</p>
            <div className="space-y-1">
              {section.items.map((item) =>
                "children" in item && item.children ? (
                  <div key={item.label}>
                    <button
                      onClick={() => setOpenMap((m) => ({ ...m, [item.label]: !(m[item.label] ?? true) }))}
                      className="flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-sm text-white/75 transition-colors hover:bg-white/5 hover:text-white"
                    >
                      <item.icon className="size-[18px]" />
                      <span className={`flex-1 text-left ${collapsed ? "hidden" : ""}`}>{item.label}</span>
                      <ChevronDown className={`size-4 transition-transform ${collapsed ? "hidden" : openMap[item.label] ?? true ? "rotate-0" : "-rotate-90"}`} />
                    </button>
                    {(openMap[item.label] ?? true) && !collapsed && (
                      <div className="mt-1 space-y-1 pl-6">
                        {item.children.map((c) => {
                          const active = path === c.href;
                          return (
                            <Link
                              key={c.href}
                              href={c.href}
                              className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors ${
                                active
                                  ? "border-l-2 border-lime font-medium text-lime"
                                  : "border-l-2 border-transparent text-white/70 hover:bg-white/5 hover:text-white"
                              }`}
                            >
                              {c.label}
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : "href" in item ? (
                  <Link key={item.href} href={item.href} title={item.label} className={itemCls(isActive(item.href))}>
                    <item.icon className="size-[18px] shrink-0" />
                    {collapsed ? <span className="sr-only">{item.label}</span> : item.label}
                  </Link>
                ) : (
                  <span key={item.label} className={`flex cursor-default items-center gap-3 rounded-xl px-4 py-2.5 text-sm text-white/45 ${collapsed ? "justify-center px-2" : ""}`}>
                    <item.icon className="size-[18px] shrink-0" />
                    {collapsed ? <span className="sr-only">{item.label}</span> : item.label}
                  </span>
                )
              )}
            </div>
          </div>
        ))}
      </nav>

      <div ref={acctRef} className={`relative mt-auto border-t border-white/10 p-4 ${collapsed ? "" : ""}`}>
        <button onClick={() => setAcctOpen(!acctOpen)}
          className={`flex w-full items-center gap-3 rounded-xl text-left hover:bg-white/5 ${collapsed ? "justify-center" : ""}`}>
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-lime/20 text-sm font-bold text-lime">
            {(me?.name ?? "H").trim().charAt(0).toUpperCase()}
          </span>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{me?.name ?? "Account"}</p>
              <p className="text-xs capitalize text-white/50">{me ? `${me.role} · Free Plan` : "Free Plan"}</p>
            </div>
          )}
          {!collapsed && <ChevronDown className={`size-4 text-white/40 transition-transform ${acctOpen ? "rotate-180" : ""}`} />}
        </button>
        {acctOpen && (
          <div className="absolute bottom-full left-4 right-4 mb-2 rounded-xl border border-white/10 bg-forest-900 p-1.5 shadow-xl">
            <div className="border-b border-white/10 px-3 py-2.5">
              <p className="text-sm font-semibold">{me?.name ?? "Signed in"}</p>
              <p className="text-xs capitalize text-white/50">{me?.role ?? ""}</p>
            </div>
            <button onClick={logout}
              className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-white/80 hover:bg-white/10 hover:text-white">
              <LogOut className="size-4" /> Sign out
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

type NotifItem = { id: string; kind: string; text: string; href: string; count: number };

export function TopBar({ tokens }: { tokens?: string }) {
  const router = useRouter();
  const [balance, setBalance] = useState(tokens ?? "—");
  const [spinning, setSpinning] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [notifs, setNotifs] = useState<{ total: number; feed: NotifItem[] } | null>(null);
  const bellRef = useDismiss(() => setBellOpen(false));

  const refresh = useCallback(async () => {
    setSpinning(true);
    try {
      const json = await fetch("/api/settings").then((r) => r.json());
      const n: number = json?.data?.aiTokens ?? 0;
      setBalance(n.toLocaleString("en-IN"));
    } finally {
      setTimeout(() => setSpinning(false), 600);
    }
  }, []);

  const loadNotifs = useCallback(async () => {
    const json = await fetch("/api/notifications").then((r) => r.json());
    setNotifs(json.data);
  }, []);

  // hydrate on mount: token balance + unread badge
  useEffect(() => {
    if (tokens === undefined) refresh();
    loadNotifs();
  }, [tokens, refresh, loadNotifs]);

  async function openBell() {
    const next = !bellOpen;
    setBellOpen(next);
    if (next) await loadNotifs();
  }

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-gray-200 bg-page px-6">
      <div className="flex items-center gap-3">
        <span className="grid size-9 place-items-center rounded-lg bg-forest-950 text-sm font-bold text-lime">V</span>
        <span className="text-base font-semibold">Veda For Vaidyas</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="flex h-10 items-center gap-2 rounded-full border border-gray-200 bg-white px-4 text-[13px]">
          <Coins className="size-4 text-gray-400" />
          <span className="font-semibold uppercase tracking-wide text-gray-500">AI Tokens:</span>
          <span className="font-bold">{balance}</span>
        </span>
        <button aria-label="Refresh token balance" onClick={refresh}
          className="grid size-10 place-items-center rounded-full border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 hover:text-gray-800">
          <RefreshCw className={`size-4 ${spinning ? "animate-spin" : ""}`} />
        </button>
        <div ref={bellRef} className="relative">
          <button aria-label="Notifications" onClick={openBell}
            className="relative grid size-10 place-items-center rounded-full border border-gray-200 bg-white text-gray-600 hover:bg-gray-50">
            <Bell className="size-[18px]" />
            {notifs && notifs.total > 0 && (
              <span className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                {notifs.total > 99 ? "99+" : notifs.total}
              </span>
            )}
          </button>
          {bellOpen && (
            <div className="absolute right-0 top-12 w-80 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-xl">
              <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
                <p className="text-sm font-bold">Notifications</p>
                {notifs && notifs.total > 0 && (
                  <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-bold text-red-600">{notifs.total}</span>
                )}
              </div>
              <div className="max-h-80 overflow-y-auto">
                {notifs?.feed.length ? (
                  notifs.feed.map((n) => (
                    <button key={n.id} onClick={() => { setBellOpen(false); router.push(n.href); }}
                      className="flex w-full items-start gap-3 border-b border-gray-50 px-4 py-3 text-left last:border-0 hover:bg-gray-50">
                      <span className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold ${
                        n.kind === "warning" ? "bg-amber-100 text-amber-700" : "bg-sky-100 text-sky-700"
                      }`}>{n.count > 99 ? "99+" : n.count}</span>
                      <span className="text-sm text-gray-700">
                        <span className="font-semibold">{n.count > 99 ? "99+" : n.count}</span> {n.text}
                      </span>
                    </button>
                  ))
                ) : (
                  <p className="px-4 py-8 text-center text-sm text-gray-400">All caught up.</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
