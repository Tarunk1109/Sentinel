"use client";

import { useId } from "react";

type ModeArtProps = {
  mode: "request" | "inspect" | "build";
  className?: string;
};

/** Decorative editorial scenes; these are illustrations, never product results. */
export function ModeArt({ mode, className = "" }: ModeArtProps) {
  const id = `mode-art-${useId().replace(/:/g, "")}`;

  return (
    <svg
      className={`mode-art mode-art-${mode} ${className}`}
      viewBox="0 0 320 190"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={`${id}-plum`} x1="99" y1="40" x2="207" y2="160" gradientUnits="userSpaceOnUse">
          <stop stopColor="#927794" /><stop offset=".48" stopColor="#69516D" /><stop offset="1" stopColor="#45324D" />
        </linearGradient>
        <linearGradient id={`${id}-porcelain`} x1="110" y1="71" x2="138" y2="150" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFFAF4" /><stop offset="1" stopColor="#DACDC9" />
        </linearGradient>
        <linearGradient id={`${id}-sage`} x1="111" y1="64" x2="219" y2="142" gradientUnits="userSpaceOnUse">
          <stop stopColor="#BFCEC0" /><stop offset="1" stopColor="#779A85" />
        </linearGradient>
        <linearGradient id={`${id}-wood`} x1="81" y1="102" x2="257" y2="154" gradientUnits="userSpaceOnUse">
          <stop stopColor="#F0D9BF" /><stop offset="1" stopColor="#DFC0A0" />
        </linearGradient>
        <filter id={`${id}-shadow`} x="-40%" y="-70%" width="180%" height="240%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>
      {mode === "request" && <RequestScene id={id} />}
      {mode === "inspect" && <InspectScene id={id} />}
      {mode === "build" && <BuildScene id={id} />}
    </svg>
  );
}

function RequestScene({ id }: { id: string }) {
  return <>
    <circle cx="164" cy="88" r="76" fill="#ECDDD9" opacity=".65" />
    <path d="M66 155H265" stroke="#C9B4B1" strokeOpacity=".35" />
    <ellipse cx="162" cy="154" rx="58" ry="9" fill="#594357" opacity=".15" filter={`url(#${id}-shadow)`} />
    <g className="mode-art-object">
      <path d="M108 109V82C108 17 213 17 213 82V109" stroke={`url(#${id}-plum)`} strokeWidth="16" strokeLinecap="round" />
      <path d="M108 80C108 24 213 24 213 80" stroke="#B29AAF" strokeWidth="5" strokeLinecap="round" />
      <path d="M117 70C126 35 192 35 204 70" stroke="#3E2D45" strokeOpacity=".28" strokeWidth="4" strokeLinecap="round" />
      <path d="M108 88V109M213 88V109" stroke="#C5B8BD" strokeWidth="8" strokeLinecap="round" />
      <path d="M108 90V106M213 90V106" stroke="#EEE4E3" strokeWidth="2" strokeLinecap="round" />
      <g transform="rotate(-10 113 121)">
        <rect x="96" y="94" width="35" height="57" rx="17" fill={`url(#${id}-plum)`} />
        <rect x="116" y="95" width="16" height="55" rx="8" fill={`url(#${id}-porcelain)`} />
        <path d="M123 103V141" stroke="#B5A5AD" strokeOpacity=".6" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M103 105V139" stroke="#B5A0B3" strokeOpacity=".5" strokeWidth="2" strokeLinecap="round" />
      </g>
      <g transform="rotate(10 207 121)">
        <rect x="189" y="94" width="35" height="57" rx="17" fill={`url(#${id}-plum)`} />
        <rect x="188" y="95" width="16" height="55" rx="8" fill={`url(#${id}-porcelain)`} />
        <path d="M195 103V141" stroke="#B5A5AD" strokeOpacity=".6" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M216 105V139" stroke="#B5A0B3" strokeOpacity=".5" strokeWidth="2" strokeLinecap="round" />
        <circle cx="215" cy="141" r="1.5" fill="#E8DADF" />
      </g>
    </g>
    <g className="mode-art-note">
      <rect x="213" y="42" width="66" height="39" rx="11" fill="#AB918F" opacity=".1" transform="translate(0 3)" />
      <rect x="213.5" y="42.5" width="65" height="38" rx="10.5" fill="#FFFBF6" stroke="#E6D8D4" />
      <circle cx="230" cy="59" r="5.5" stroke="#806782" strokeWidth="1.5" />
      <path d="m234 63 4 4" stroke="#806782" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M249 57h17M249 64h11" stroke="#C5B5C1" strokeWidth="2.5" strokeLinecap="round" />
    </g>
    <path d="M76 81v10M71 86h10" stroke="#B38471" strokeWidth="1.5" strokeLinecap="round" />
    <circle cx="249" cy="134" r="3" fill="#B78C79" opacity=".65" />
  </>;
}

function InspectScene({ id }: { id: string }) {
  return <>
    <circle cx="163" cy="89" r="77" fill="#DCE5DC" opacity=".7" />
    <ellipse cx="163" cy="162" rx="74" ry="7" fill="#4B6855" opacity=".12" filter={`url(#${id}-shadow)`} />
    <g className="mode-art-object">
      <g transform="rotate(-7 161 98)">
        <rect x="92" y="27" width="140" height="139" rx="10" fill="#819B87" opacity=".12" transform="translate(2 4)" />
        <rect x="91.5" y="26.5" width="140" height="139" rx="9.5" fill="#FFFCF5" stroke="#D1DCD0" />
        <rect x="101" y="36" width="120" height="109" rx="5" fill="#ECF0E7" />
        <path d="M113 52v-7h8M201 45h8v7M113 128v7h8M201 135h8v-7" stroke="#9BB39F" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M161 79v5c0 8 8 14 20 14h2c22 0 23 30 2 30h-37c-13 0-20-10-20-20V87" stroke="#738D7A" strokeOpacity=".15" strokeWidth="9" strokeLinecap="round" transform="translate(1 3)" />
        <path d="M161 79v5c0 8 8 14 20 14h2c22 0 23 30 2 30h-37c-13 0-20-10-20-20V87" stroke="#64836F" strokeWidth="7" strokeLinecap="round" />
        <path d="M160 81c0 11 8 17 22 17 10 0 16 7 16 14" stroke="#9EB6A3" strokeWidth="2" strokeLinecap="round" />
        <rect x="151" y="59" width="20" height="24" rx="5" fill={`url(#${id}-sage)`} />
        <rect x="154" y="50" width="14" height="13" rx="4" fill="#CFD5D1" />
        <rect x="156" y="50" width="10" height="5" rx="2.5" fill="#65796C" />
        <path d="M156 66v10" stroke="#D7E3D6" strokeWidth="1.5" strokeLinecap="round" />
        <rect x="118" y="68" width="20" height="23" rx="5" fill={`url(#${id}-sage)`} />
        <path d="M121 57h14v13h-14z" fill="#CFD5D1" />
        <path d="M125 60v3m6-3v3" stroke="#81958B" strokeWidth="2" />
        <path d="M122 75v9" stroke="#D7E3D6" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="109" cy="155" r="2" fill="#A9BBAA" />
        <path d="M117 155h34" stroke="#D0D9CD" strokeWidth="2.5" strokeLinecap="round" />
      </g>
    </g>
    <g className="mode-art-note">
      <rect x="221" y="109" width="42" height="42" rx="13" fill="#E3ECE1" stroke="#C7D7C8" />
      <path d="M230 119h6m-6 0v6m18-6h6m0 0v6m-24 11h6m-6 0v-6m18 6h6m0 0v-6" stroke="#6A8A73" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="242" cy="127.5" r="4.5" stroke="#6A8A73" strokeWidth="1.5" />
    </g>
    <path d="M71 106v10M66 111h10" stroke="#95AA93" strokeWidth="1.5" strokeLinecap="round" />
    <circle cx="255" cy="53" r="3" fill="#A4B89E" />
  </>;
}

function BuildScene({ id }: { id: string }) {
  return <>
    <ellipse cx="166" cy="94" rx="99" ry="75" fill="#EEE3D5" opacity=".7" />
    <ellipse cx="168" cy="168" rx="101" ry="10" fill="#8B6C55" opacity=".12" filter={`url(#${id}-shadow)`} />
    <g className="mode-art-object">
      <path d="M69 128v29l6 3v-30M270 128v29l-6 3v-30M166 157v24l6 2v-26" stroke="#977B66" strokeWidth="4" strokeLinejoin="round" />
      <path d="m55 112 118-43 114 44-117 45z" fill={`url(#${id}-wood)`} stroke="#D5B595" strokeLinejoin="round" />
      <path d="m55 112 115 42 117-41v8l-117 42-115-43z" fill="#C7A887" />
      <path d="m55 112 115 42v9l-115-43z" fill="#DABD9D" />
      <path d="m74 111 37-13m-21 20 26-9m91 18 40-14" stroke="#C19D7B" strokeOpacity=".26" strokeLinecap="round" />
      <path d="m156 100 20-7 20 8-20 8z" fill="#958F88" />
      <path d="m175 85 7 3v14l-7-2z" fill="#ADA9A1" />
      <path d="m125 28 98 34v57l-98-35z" fill="#635A62" stroke="#635A62" strokeWidth="4" strokeLinejoin="round" />
      <path d="m125 28 3-2 98 34v57l-3 2V62z" fill="#8B7D86" />
      <path d="m129 35 89 31v44l-89-31z" fill="#E0DFCF" />
      <path d="m129 63 21-10 26 22 23-7 19 21v21l-89-31z" fill="#ABB9A0" />
      <path d="m129 70 27-3 31 29 31-8v22l-89-31z" fill="#7F9B83" />
      <path d="m164 66 23 30 31 3v11l-63-22z" fill="#65826F" />
      <ellipse cx="198" cy="69" rx="8" ry="7" transform="rotate(20 198 69)" fill="#F7EDD2" />
      <path d="m129 35 89 31" stroke="#FFF9EF" strokeOpacity=".6" />
      <path d="m136 116 21-8 42 16-22 8z" fill="#BDAE9E" />
      <path d="m136 113 21-8 42 16-22 8z" fill="#F6F0E4" stroke="#DFD4C4" strokeLinejoin="round" />
      <path d="m144 113 32 12m-26-15 32 12m-22-14-8 9m18-5-8 9m18-5-8 9" stroke="#C9BCAF" strokeWidth="1.2" />
      <ellipse cx="208" cy="130" rx="7" ry="4.5" transform="rotate(-17 208 130)" fill="#EEE7DB" stroke="#D4C4B2" />
      <path d="m207 127 3 1" stroke="#C5B6A9" strokeLinecap="round" />
      <ellipse cx="92" cy="103" rx="17" ry="6" fill="#9F6956" />
      <ellipse cx="92" cy="101" rx="17" ry="6" fill="#CF987D" />
      <path d="M92 100V59l13-12" stroke="#AE755F" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m98 41 17 6 9 18-38-13z" fill="#C38B71" />
      <path d="m98 41 17 6-12 12-17-7z" fill="#DBAD90" />
      <ellipse cx="105" cy="59" rx="20" ry="4" transform="rotate(19 105 59)" fill="#946450" />
      <ellipse cx="105" cy="59" rx="16" ry="2.5" transform="rotate(19 105 59)" fill="#F5DFC2" />
      <ellipse cx="243" cy="127" rx="13" ry="5" fill="#AD947B" opacity=".25" />
      <path d="m232 112 3 15c4 4 12 4 16 0l3-15" fill="#C8B49B" />
      <ellipse cx="243" cy="112" rx="11" ry="4.5" fill="#E5D4BB" />
      <ellipse cx="243" cy="112" rx="8" ry="3" fill="#8E8770" />
      <path d="M243 114V91m0 13-9-11m9 7 7-16" stroke="#687F61" strokeWidth="2" strokeLinecap="round" />
      <path d="M242 98c-13 0-17-10-15-16 10 1 17 6 15 16" fill="#7E9B71" />
      <path d="M245 96c-3-11 4-21 12-23 2 11-2 19-12 23" fill="#91AB7E" />
      <path d="M243 107c5-10 14-12 20-8-5 10-13 12-20 8" fill="#6B8A65" />
    </g>
    <path d="M60 59v10M55 64h10" stroke="#B49B7F" strokeWidth="1.5" strokeLinecap="round" />
    <circle cx="269" cy="78" r="2.5" fill="#C89B7C" />
  </>;
}
