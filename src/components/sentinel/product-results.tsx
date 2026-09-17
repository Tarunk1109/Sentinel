"use client";

import { ArrowDownUp, ArrowRight, Check, ExternalLink, ImageOff, PackageSearch, ShieldCheck, ShieldQuestion, Sparkles } from "lucide-react";
import { useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import type { ProductCandidate, RequestMission } from "@/lib/domain/commerce";
import { compatibilityLabels, displayPrice, publicUrl } from "./commerce-display";

function ProductCard({ product, selected, onSelect, topMatch }: { product: ProductCandidate; selected: boolean; onSelect: (product: ProductCandidate) => void; topMatch: boolean }) {
  const [imageFailed, setImageFailed] = useState(false);
  const url = publicUrl(product.productUrl);
  const imageUrl = publicUrl(product.imageUrl);
  const compatibility = product.compatibility.status;
  return <article className={`product-card ${selected ? "is-selected" : ""}`}>
    <div className="product-visual">{imageUrl && !imageFailed ? <Image src={imageUrl} alt={product.name} width={360} height={210} unoptimized onError={() => setImageFailed(true)} className="product-image" /> : <div className="product-image-missing"><ImageOff size={30} strokeWidth={1.2} /><span>Image unavailable</span></div>}{topMatch && <span className="recommendation"><Sparkles size={11} />TOP MATCH</span>}{selected && <span className="selected-indicator" aria-label="Selected product"><Check size={13} /></span>}</div>
    <div className="product-content"><div className="product-merchant"><span>{product.merchantName}</span><span className="availability"><i className={product.availability === "available" ? "available" : ""} />{product.availability === "available" ? "Listed available" : product.availability === "unavailable" ? "Unavailable" : "Stock unconfirmed"}</span></div><h3>{product.name}</h3><div className={`compatibility-badge compatibility-${compatibility.toLowerCase()}`}>{compatibility === "VERIFIED" ? <ShieldCheck size={12} /> : <ShieldQuestion size={12} />}{compatibilityLabels[compatibility]}</div>
      <p className="recommendation-label">Why this option</p><p className="product-description">{product.recommendation || "A catalogue match for your request. Review the listing details before choosing."}</p>
      {product.compatibility.reasons.length > 0 && <details className="product-evidence"><summary>View supporting evidence<span>{product.compatibility.reasons.length}</span></summary>{product.compatibility.reasons.map((reason, index) => <div key={index}><p>{reason.claim}</p><blockquote>“{reason.evidenceQuote}”</blockquote></div>)}</details>}
      {product.compatibility.missingInformation.length > 0 && <details className="product-missing"><summary>What still needs checking</summary><ul>{product.compatibility.missingInformation.map(item => <li key={item}>{item}</li>)}</ul></details>}
      {product.onboardRequired && <p className="merchant-setup-note">Merchant preparation needed before quoting.</p>}
      <div className="product-price-row"><div className="product-price">{displayPrice(product.price)}<span>Browse price · per item</span></div><Button variant={selected ? "default" : "outline"} size="sm" onClick={() => onSelect(product)} aria-pressed={selected}>{selected ? <><Check />Selected</> : <>Select<ArrowRight /></>}</Button></div>
      {url && <a className="merchant-link" href={url} target="_blank" rel="noopener noreferrer">View merchant listing<ExternalLink size={11} /><span className="sr-only"> (opens in a new tab)</span></a>}
    </div>
  </article>;
}

function LoadingCards() {
  return <div className="product-grid skeleton-grid" aria-label="Searching for products"><span className="sr-only" role="status">Searching real product listings. Results will appear here.</span>{[0, 1].map(index => <div className="product-skeleton panel" key={index} aria-hidden="true"><div className="skeleton-image skeleton" /><div className="skeleton-content"><span className="skeleton skeleton-small" /><span className="skeleton skeleton-title" /><span className="skeleton skeleton-title short" /><span className="skeleton skeleton-badge" /><span className="skeleton skeleton-line" /><span className="skeleton skeleton-line short" /><div><span className="skeleton skeleton-price" /><span className="skeleton skeleton-button" /></div></div></div>)}</div>;
}

export function ProductResults({ mission, isRunning, selectedId, onSelect }: { mission: RequestMission | null; isRunning: boolean; selectedId: string | null; onSelect: (product: ProductCandidate) => void }) {
  const [sort, setSort] = useState<"rank" | "price">("rank");
  const products = [...(mission?.products ?? [])];
  if (sort === "price") products.sort((a, b) => (a.price?.amountMinor ?? Infinity) - (b.price?.amountMinor ?? Infinity));
  return <section id="results" className="results-section" aria-labelledby="results-heading" aria-busy={isRunning}>
    <div className="results-heading"><div><h2 id="results-heading">Your shortlist{mission && <span>{products.length}</span>}</h2><p>{isRunning ? "Finding options that fit your request…" : mission ? "Live listings. Browse prices exclude shipping and tax." : "Good choices start with the right information."}</p></div>{products.length > 0 && <Button size="sm" variant="ghost" onClick={() => setSort(sort === "rank" ? "price" : "rank")}><ArrowDownUp />{sort === "rank" ? "Recommended" : "Price"}</Button>}</div>
    {isRunning ? <LoadingCards /> : mission ? <><div className={`mission-summary ${products.length === 0 ? "no-results-summary" : ""}`}><Sparkles size={16} /><div><p>{mission.summary}</p>{mission.cacheHit && <span className="cache-note">Cached result · valid until {new Date(mission.expiresAt).toLocaleTimeString()}</span>}{mission.warnings.length > 0 && <details><summary>{mission.warnings.length} {mission.warnings.length === 1 ? "detail" : "details"} to keep in mind</summary>{mission.warnings.map(warning => <p key={warning}>{warning}</p>)}</details>}</div></div>{products.length > 0 ? <div className="product-grid">{products.map((product, index) => <ProductCard key={product.id} product={product} selected={selectedId === product.id} topMatch={sort === "rank" && index === 0 && product.score > 0 && product.compatibility.reasons.length > 0 && product.requiredConstraintsSatisfied === true && (product.compatibility.status === "VERIFIED" || product.compatibility.status === "LIKELY_COMPATIBLE")} onSelect={onSelect} />)}</div> : <div className="empty-results panel"><span className="empty-icon"><PackageSearch size={28} strokeWidth={1.4} /></span><h3>No matches within your constraints.</h3><p>Try a more specific description or adjust your request.<br />Your budget stays exactly where you set it.</p></div>}</> : <div className="empty-results panel"><div className="empty-card-illustration" aria-hidden="true"><span className="illustration-card left"><i /><b /><em /></span><span className="illustration-card center"><PackageSearch size={26} strokeWidth={1.3} /><b /><em /><span><Check size={11} /></span></span><span className="illustration-card right"><i /><b /><em /></span></div><h3>Your next great find belongs here.</h3><p>Tell us what you need. We’ll bring back real options,<br />with the evidence to help you choose.</p><div className="empty-benefits"><span><Check size={12} />Your constraints</span><span><Check size={12} />Real products</span><span><Check size={12} />Clear evidence</span></div></div>}
  </section>;
}
