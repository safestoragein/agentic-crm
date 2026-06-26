"use client";

import { useEffect, useRef } from "react";

// Same Google Maps JS key + Places library the legacy PHP CRM uses for its
// "create quotation" pickup-address field. Overridable via env, falls back to
// the existing key so it works out of the box.
const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "AIzaSyCse5f97FoDXrT5kKoeB1XGCxeCs12-mOE";

let mapsPromise = null;

// Inject the Maps JS + Places script exactly once per page, returning a promise
// that resolves when `google.maps.places` is ready.
function loadGoogleMaps() {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (window.google?.maps?.places) return Promise.resolve(window.google);
  if (mapsPromise) return mapsPromise;

  mapsPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById("google-maps-places");
    if (existing) {
      existing.addEventListener("load", () => resolve(window.google));
      existing.addEventListener("error", reject);
      return;
    }
    const s = document.createElement("script");
    s.id = "google-maps-places";
    s.src = `https://maps.googleapis.com/maps/api/js?key=${MAPS_KEY}&libraries=places`;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve(window.google);
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return mapsPromise;
}

/**
 * Text input with Google Places autocomplete, restricted to India — mirrors the
 * legacy CRM's pickup-address field. `value`/`onChange` keep it controlled; the
 * picked place's formatted_address is pushed back through onChange.
 */
export default function PlacesAutocompleteInput({ value, onChange, className, placeholder, country = "in" }) {
  const inputRef = useRef(null);
  const acRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then((google) => {
        if (cancelled || !google || !inputRef.current || acRef.current) return;
        const ac = new google.maps.places.Autocomplete(inputRef.current, {
          componentRestrictions: { country },
          fields: ["formatted_address", "geometry", "name"],
        });
        ac.addListener("place_changed", () => {
          const place = ac.getPlace();
          const addr = place?.formatted_address || place?.name;
          if (addr) onChange?.(addr);
        });
        acRef.current = ac;
      })
      .catch(() => {
        // Maps failed to load — input still works as a plain text field.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country]);

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      className={className}
      placeholder={placeholder}
      autoComplete="off"
    />
  );
}
