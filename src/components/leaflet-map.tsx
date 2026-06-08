import { MapContainer, TileLayer, Marker, Popup, Circle, useMapEvents } from "react-leaflet";
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
  last_launched_at: string | null;
  launched_today: boolean;
  today_launch_count: number;
};

interface Props {
  placed: PlacedAccount[];
  visuals: boolean;
  radiusMode: "daily" | "all";
  tempPin?: { lat: number; lng: number } | null;
  onMapClick?: (lat: number, lng: number) => void;
}

const FIFTY_MILES_IN_METERS = 80467;

function ClickToPlace({ onPlace }: { onPlace: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPlace(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export default function LeafletMap({ placed, visuals, radiusMode, tempPin, onMapClick }: Props) {
  const items: React.ReactNode[] = [];

  for (const account of placed) {
    if (visuals) {
      const fullRadius = radiusMode === "all" || account.launched_today;
      items.push(
        <Circle
          key={`c-${account.id}`}
          center={[account.latitude, account.longitude]}
          radius={fullRadius ? FIFTY_MILES_IN_METERS : 12000}
          pathOptions={{
            color: account.launched_today ? "#14b8a6" : "#94a3b8",
            fillColor: account.launched_today ? "#14b8a6" : "#94a3b8",
            fillOpacity: fullRadius ? 0.14 : 0.05,
            weight: fullRadius ? 2 : 1,
            dashArray: account.launched_today ? undefined : "4 6",
          }}
        >
          <Popup>
            <CoveragePopup account={account} />
          </Popup>
        </Circle>,
      );
    }

    items.push(
      <Marker key={`m-${account.id}`} position={[account.latitude, account.longitude]}>
        <Popup>
          <CoveragePopup account={account} />
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
      {onMapClick && <ClickToPlace onPlace={onMapClick} />}
      {tempPin && (
        <>
          <Circle
            center={[tempPin.lat, tempPin.lng]}
            radius={FIFTY_MILES_IN_METERS}
            pathOptions={{
              color: "#ef4444",
              fillColor: "#ef4444",
              fillOpacity: 0.18,
              weight: 2,
            }}
          />
          <Marker position={[tempPin.lat, tempPin.lng]}>
            <Popup>
              <div className="text-[12px]">
                <div className="font-semibold">Temporary 50-mile radius</div>
                <div className="text-slate-500 mt-1">Clears when you leave this page.</div>
              </div>
            </Popup>
          </Marker>
        </>
      )}
      {items}
    </MapContainer>
  );
}

function CoveragePopup({ account }: { account: PlacedAccount }) {
  return (
    <div className="text-[12.5px] min-w-[170px]">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">Account name</div>
      <div className="font-semibold">{account.name}</div>
      <div className="text-[10px] uppercase tracking-wide text-slate-500 mt-2">Account area</div>
      <div>{account.area ?? "-"}</div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
        <div>
          <div className="text-slate-500">Today</div>
          <div className="font-medium">{account.launched_today ? "Covered" : "Missing"}</div>
        </div>
        <div>
          <div className="text-slate-500">Launch count</div>
          <div className="font-medium tabular-nums">{account.today_launch_count}</div>
        </div>
      </div>
      {account.last_launched_at && (
        <div className="mt-2 text-[11px] text-slate-500">
          Last launch: {new Date(account.last_launched_at).toLocaleString()}
        </div>
      )}
    </div>
  );
}
