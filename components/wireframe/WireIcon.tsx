import {
  ArrowRight,
  Bell,
  BookOpen,
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Download,
  Eye,
  Filter,
  Globe,
  Heart,
  Home,
  Info,
  Lock,
  Mail,
  MapPin,
  Menu,
  Plus,
  RefreshCw,
  Search,
  ShoppingCart,
  SlidersHorizontal,
  Star,
  Trash2,
  TriangleAlert,
  Upload,
  User,
  X,
  type LucideIcon,
} from "lucide-react";
import { WIRE_BRANDS } from "@/lib/wireframe/icons";

/**
 * Renders a wireframe glyph. Lucide components for the UI set (static
 * imports, tree-shaken); vendored brand paths for GitHub/LinkedIn, which
 * Lucide no longer ships.
 */
const UI: Record<string, LucideIcon> = {
  menu: Menu,
  x: X,
  plus: Plus,
  check: Check,
  "chevron-right": ChevronRight,
  "chevron-down": ChevronDown,
  "arrow-right": ArrowRight,
  search: Search,
  bell: Bell,
  user: User,
  home: Home,
  sliders: SlidersHorizontal,
  trash: Trash2,
  eye: Eye,
  star: Star,
  heart: Heart,
  mail: Mail,
  book: BookOpen,
  lock: Lock,
  globe: Globe,
  calendar: Calendar,
  clock: Clock,
  pin: MapPin,
  download: Download,
  upload: Upload,
  filter: Filter,
  cart: ShoppingCart,
  info: Info,
  alert: TriangleAlert,
  refresh: RefreshCw,
};

export function WireIcon({ name, size = 28 }: { name: string; size?: number }) {
  const Comp = UI[name];
  if (Comp) return <Comp size={size} aria-hidden="true" className="shrink-0 text-[#57534A]" />;
  const brand = WIRE_BRANDS[name] ?? WIRE_BRANDS.linkedin;
  return (
    <svg width={size} height={size} viewBox={brand.viewBox} fill="currentColor" aria-hidden="true" className="shrink-0 text-[#57534A]">
      {brand.els.map((el, i) => (
        <path key={i} d={el.d} />
      ))}
    </svg>
  );
}
