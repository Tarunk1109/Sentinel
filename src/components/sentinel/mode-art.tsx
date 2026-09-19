"use client";

import { useId } from "react";

type ModeArtProps = {
  mode: "request" | "inspect" | "build";
  className?: string;
};

/** Decorative product studies; these are illustrations, never product results. */
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
        <linearGradient id={`${id}-graphite`} x1="99" y1="40" x2="207" y2="160" gradientUnits="userSpaceOnUse">
          <stop stopColor="#617D80" /><stop offset=".48" stopColor="#294B50" /><stop offset="1" stopColor="#172B3A" />
        </linearGradient>
        <linearGradient id={`${id}-silver`} x1="110" y1="71" x2="138" y2="150" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FAFCFD" /><stop offset="1" stopColor="#CCD6DD" />
        </linearGradient>
        <linearGradient id={`${id}-steel`} x1="111" y1="64" x2="219" y2="142" gradientUnits="userSpaceOnUse">
          <stop stopColor="#A8BCD3" /><stop offset="1" stopColor="#3C65A0" />
        </linearGradient>
        <linearGradient id={`${id}-wood`} x1="81" y1="102" x2="257" y2="154" gradientUnits="userSpaceOnUse">
          <stop stopColor="#E3D7C6" /><stop offset="1" stopColor="#C7B59B" />
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
    <ellipse cx="163" cy="92" rx="87" ry="70" fill="#E6EFEC" opacity=".62" />
    <path d="M67 156H263M84 151v10M245 151v10" stroke="#94AAA6" strokeOpacity=".4" />
    <path d="M73 117V68h12M246 95v22h-12" stroke="#BDD0C8" strokeWidth=".8" />
    <ellipse cx="162" cy="154" rx="58" ry="9" fill="#172B3A" opacity=".15" filter={`url(#${id}-shadow)`} />
    <g className="mode-art-object">
      <path d="M108 109V82C108 17 213 17 213 82V109" stroke={`url(#${id}-graphite)`} strokeWidth="16" strokeLinecap="round" />
      <path d="M108 80C108 24 213 24 213 80" stroke="#8BA5A6" strokeWidth="3" strokeLinecap="round" />
      <path d="M117 70C126 35 192 35 204 70" stroke="#122A32" strokeOpacity=".28" strokeWidth="4" strokeLinecap="round" />
      <path d="M108 88V109M213 88V109" stroke="#AAB8C0" strokeWidth="8" strokeLinecap="round" />
      <path d="M108 90V106M213 90V106" stroke="#EEF3F6" strokeWidth="2" strokeLinecap="round" />
      <g transform="rotate(-10 113 121)">
        <rect x="96" y="94" width="35" height="57" rx="17" fill={`url(#${id}-graphite)`} />
        <rect x="116" y="95" width="16" height="55" rx="8" fill={`url(#${id}-silver)`} />
        <path d="M123 103V141" stroke="#899CA8" strokeOpacity=".6" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M103 105V139" stroke="#A0B5B7" strokeOpacity=".5" strokeWidth="2" strokeLinecap="round" />
        <path d="M101 115v11M105 113v15M109 113v15" stroke="#142F37" strokeOpacity=".45" strokeWidth="1" strokeLinecap="round" />
      </g>
      <g transform="rotate(10 207 121)">
        <rect x="189" y="94" width="35" height="57" rx="17" fill={`url(#${id}-graphite)`} />
        <rect x="188" y="95" width="16" height="55" rx="8" fill={`url(#${id}-silver)`} />
        <path d="M195 103V141" stroke="#899CA8" strokeOpacity=".6" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M216 105V139" stroke="#A0B5B7" strokeOpacity=".5" strokeWidth="2" strokeLinecap="round" />
        <rect x="210" y="111" width="9" height="20" rx="4.5" stroke="#8BA5A6" strokeOpacity=".4" />
        <path d="M214.5 118v5" stroke="#C1D4CF" strokeWidth="1.3" strokeLinecap="round" />
        <circle cx="215" cy="141" r="1.5" fill="#B6D5C9" />
      </g>
    </g>
    <g className="mode-art-note">
      <rect x="213" y="42" width="66" height="39" rx="7" fill="#6E8580" opacity=".07" transform="translate(0 3)" />
      <rect x="213.5" y="42.5" width="65" height="38" rx="6.5" fill="#FFFFFF" stroke="#D7E1DE" />
      <circle cx="230" cy="59" r="5.5" stroke="#176B5B" strokeWidth="1.5" />
      <path d="m234 63 4 4" stroke="#176B5B" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M249 57h17M249 64h11" stroke="#A8BBB4" strokeWidth="2.5" strokeLinecap="round" />
    </g>
    <path d="M72 136h18M72 140h10" stroke="#AABDB5" strokeWidth="1" strokeLinecap="round" />
  </>;
}

function InspectScene({ id }: { id: string }) {
  return <>
    <ellipse cx="163" cy="92" rx="86" ry="72" fill="#E8EDF5" opacity=".7" />
    <path d="M76 49v-8h16M251 72V47h-10M70 156h17" stroke="#BECEDF" strokeWidth=".8" />
    <ellipse cx="163" cy="162" rx="74" ry="7" fill="#304F70" opacity=".12" filter={`url(#${id}-shadow)`} />
    <g className="mode-art-object">
      <g transform="rotate(-5 161 98)">
        <rect x="92" y="27" width="140" height="139" rx="10" fill="#7F94B2" opacity=".12" transform="translate(2 4)" />
        <rect x="91.5" y="26.5" width="140" height="139" rx="9.5" fill="#FFFFFF" stroke="#CFD9E4" />
        <rect x="101" y="36" width="120" height="109" rx="5" fill="#F1F5F9" />
        <path d="M101 63h120M101 90h120M101 117h120M131 36v109M161 36v109M191 36v109" stroke="#E3EAF2" strokeWidth=".65" />
        <path d="M113 52v-7h8M201 45h8v7M113 128v7h8M201 135h8v-7" stroke="#8DA5C4" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M161 79v5c0 8 8 14 20 14h2c22 0 23 30 2 30h-37c-13 0-20-10-20-20V87" stroke="#557393" strokeOpacity=".15" strokeWidth="9" strokeLinecap="round" transform="translate(1 3)" />
        <path d="M161 79v5c0 8 8 14 20 14h2c22 0 23 30 2 30h-37c-13 0-20-10-20-20V87" stroke="#365575" strokeWidth="7" strokeLinecap="round" />
        <path d="M160 81c0 11 8 17 22 17 10 0 16 7 16 14" stroke="#94AFCB" strokeWidth="2" strokeLinecap="round" />
        <rect x="151" y="59" width="20" height="24" rx="5" fill={`url(#${id}-steel)`} />
        <rect x="154" y="50" width="14" height="13" rx="4" fill="#CCD5DC" />
        <rect x="156" y="50" width="10" height="5" rx="2.5" fill="#3F5365" />
        <path d="M156 66v10" stroke="#D8E4F0" strokeWidth="1.5" strokeLinecap="round" />
        <rect x="118" y="68" width="20" height="23" rx="5" fill={`url(#${id}-steel)`} />
        <path d="M121 57h14v13h-14z" fill="#CCD5DC" />
        <path d="M125 60v3m6-3v3" stroke="#8696A7" strokeWidth="2" />
        <path d="M122 75v9" stroke="#D8E4F0" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M119 86h18M152 79h18" stroke="#28486C" strokeOpacity=".45" strokeWidth="1" />
        <circle cx="109" cy="155" r="2" fill="#7092BC" />
        <path d="M117 155h34" stroke="#C8D5E3" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M196 151v7M199 152v6M202 151v7M206 152v6M209 151v7M212 152v6" stroke="#A6B8CC" strokeWidth="1" />
      </g>
    </g>
    <g className="mode-art-note">
      <rect x="221" y="109" width="42" height="42" rx="9" fill="#F7FAFD" stroke="#CAD7E6" />
      <path d="M230 119h6m-6 0v6m18-6h6m0 0v6m-24 11h6m-6 0v-6m18 6h6m0 0v-6" stroke="#3C65A0" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="242" cy="127.5" r="4.5" stroke="#3C65A0" strokeWidth="1.5" />
    </g>
    <path d="M70 98h12M70 102h7" stroke="#A2B5CC" strokeWidth="1" strokeLinecap="round" />
  </>;
}

function BuildScene({ id }: { id: string }) {
  return <>
    <ellipse cx="166" cy="94" rx="99" ry="75" fill="#F1ECE5" opacity=".7" />
    <path d="M66 158 167 186 277 149M71 162l-3 6M269 151l3 6" stroke="#CEBFA9" strokeOpacity=".6" strokeWidth=".8" />
    <ellipse cx="168" cy="168" rx="101" ry="10" fill="#65594B" opacity=".12" filter={`url(#${id}-shadow)`} />
    <g className="mode-art-object">
      <path d="M69 128v29l6 3v-30M270 128v29l-6 3v-30M166 157v24l6 2v-26" stroke="#6E7676" strokeWidth="4" strokeLinejoin="round" />
      <path d="m55 112 118-43 114 44-117 45z" fill={`url(#${id}-wood)`} stroke="#B8A48B" strokeLinejoin="round" />
      <path d="m55 112 115 42 117-41v8l-117 42-115-43z" fill="#AB957A" />
      <path d="m55 112 115 42v9l-115-43z" fill="#C5B298" />
      <path d="m74 111 37-13m-21 20 26-9m91 18 40-14" stroke="#958069" strokeOpacity=".26" strokeLinecap="round" />
      <path d="m156 100 20-7 20 8-20 8z" fill="#879198" />
      <path d="m175 85 7 3v14l-7-2z" fill="#BBC4C8" />
      <path d="m125 28 98 34v57l-98-35z" fill="#243843" stroke="#243843" strokeWidth="4" strokeLinejoin="round" />
      <path d="m125 28 3-2 98 34v57l-3 2V62z" fill="#647D88" />
      <path d="m129 35 89 31v44l-89-31z" fill="#E9F0F2" />
      <path d="m129 35 17 6v44l-17-6z" fill="#C6D6D8" />
      <path d="m134 43 7 2m-7 5 7 2m-7 5 7 2m-7 5 7 2" stroke="#7F9B9E" strokeWidth="1.4" strokeLinecap="round" />
      <path d="m153 51 24 8m-24-3 15 5" stroke="#6D8D8E" strokeWidth="1.6" strokeLinecap="round" />
      <path d="m153 66 25 9v22l-25-9z" fill="#FFFFFF" stroke="#D4DFE1" strokeWidth=".6" />
      <path d="m182 76 28 10v22l-28-10z" fill="#FFFFFF" stroke="#D4DFE1" strokeWidth=".6" />
      <path d="m158 84 4-7 4 5 7-2" stroke="#438774" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m188 94 3 1m2-3 3 1m2-4 3 1m2-4 3 1" stroke="#6F92B5" strokeWidth="3" />
      <path d="m129 35 89 31" stroke="#FFFFFF" strokeOpacity=".6" />
      <path d="m136 116 21-8 42 16-22 8z" fill="#99A5AB" />
      <path d="m136 113 21-8 42 16-22 8z" fill="#F4F7F8" stroke="#CAD4D8" strokeLinejoin="round" />
      <path d="m144 113 32 12m-26-15 32 12m-22-14-8 9m18-5-8 9m18-5-8 9" stroke="#AAB8BF" strokeWidth="1.2" />
      <ellipse cx="208" cy="130" rx="7" ry="4.5" transform="rotate(-17 208 130)" fill="#F4F7F8" stroke="#B8C5CA" />
      <path d="m207 127 3 1" stroke="#95A8B0" strokeLinecap="round" />
      <ellipse cx="92" cy="103" rx="17" ry="6" fill="#78624A" />
      <ellipse cx="92" cy="101" rx="17" ry="6" fill="#B2946F" />
      <path d="M92 100V59l13-12" stroke="#987043" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m98 41 17 6 9 18-38-13z" fill="#A78C69" />
      <path d="m98 41 17 6-12 12-17-7z" fill="#C6B192" />
      <ellipse cx="105" cy="59" rx="20" ry="4" transform="rotate(19 105 59)" fill="#796247" />
      <ellipse cx="105" cy="59" rx="16" ry="2.5" transform="rotate(19 105 59)" fill="#F2E9D7" />
      <ellipse cx="243" cy="127" rx="13" ry="5" fill="#958574" opacity=".25" />
      <path d="m232 112 3 15c4 4 12 4 16 0l3-15" fill="#D2CCC2" />
      <ellipse cx="243" cy="112" rx="11" ry="4.5" fill="#EAE5DC" />
      <ellipse cx="243" cy="112" rx="8" ry="3" fill="#797F6C" />
      <path d="M243 114V91m0 13-9-11m9 7 7-16" stroke="#4D6F5E" strokeWidth="2" strokeLinecap="round" />
      <path d="M242 98c-13 0-17-10-15-16 10 1 17 6 15 16" fill="#7B9984" />
      <path d="M245 96c-3-11 4-21 12-23 2 11-2 19-12 23" fill="#9AB19F" />
      <path d="M243 107c5-10 14-12 20-8-5 10-13 12-20 8" fill="#527963" />
    </g>
    <path d="M58 62V46h16M269 85V69h-9" stroke="#C7B9A6" strokeWidth=".8" />
  </>;
}
