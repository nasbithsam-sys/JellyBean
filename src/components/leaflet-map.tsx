import { MapContainer, TileLayer, Marker, Popup, Circle } from "react-leaflet";
import L from "leaflet";

const DefaultIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

export type PlacedAccount = {
  id: string;
  name: string;
  area: string | null;
  latitude: number;
  longitude: number;
  last_opened_at: string | null;
};

interface Props {
  placed: PlacedAccount[];
  visuals: boolean;
}

function isActive(a: { last_opened_at: string | null }) {
  if (!a.last_opened_at) return false;
  return Date.now() - new Date(a.last_opened_at).getTime() < 1000 * 60 * 60 * 24 * 14;
}

export default function LeafletMap({ placed, visuals }: Props) {
  const items: React.ReactNode[] = [];
  for (const a of placed) {
    const active = isActive(a);
    if (visuals) {
      items.push(
        <Circle
          key={`c-${a.id}`}
          center={[a.latitude, a.longitude]}
          radius={active ? 60000 : 30000}
          pathOptions={{
            color: active ? "#22c55e" : "#94a3b8",
            fillOpacity: 0.15,
            weight: 1,
          }}
        />,
      );
    }
    items.push(
      <Marker key={`m-${a.id}`} position={[a.latitude, a.longitude]}>
        <Popup>
          <div className="text-[12.5px]">
            <div className="font-semibold">{a.name}</div>
            <div className="text-muted-foreground">{a.area ?? "—"}</div>
            <div className="mt-1 text-[11px]">{active ? "Active" : "Idle"}</div>
          </div>
        </Popup>
      </Marker>,
    );
  }

  return (
    <MapContainer
      center={[39.5, -98.35]}
      zoom={4}
      minZoom={3}
      scrollWheelZoom
      style={{ height: "100%", width: "100%" }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {items}
    </MapContainer>
  );
}
