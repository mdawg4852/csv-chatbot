import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, Button, Input, Badge } from "./ui";
import { RotateCcw, FileSearch, Sparkles } from "lucide-react";

/** ---------- Types ---------- */
type Answers = Record<string, string>;
type Question = {
  id: "q1" | "q2" | "q3" | "q4" | "q5";
  prompt: string;
  csvColumn?: "state" | "city" | "bond_limit" | "name";
  mode?: "equals";
  placeholder?: string;
  inputType: "text" | "number" | "date";
};
type PurchaseField = {
  id: "companyName" | "contactName" | "companyAddress" | "contactPhone" | "contactEmail";
  prompt: string;
  type: "text" | "tel" | "email" | "address";
  hint?: string;
};
type BondRow = {
  state: string;
  city: string;
  bond_limit: number | string;
  name: string;
  premium?: number | string | null;
};

/** ---------- Config ---------- */
const QUESTION_CONFIG: Question[] = [
  { id: "q1", prompt: "Which state is the bond located in?", csvColumn: "state", mode: "equals", placeholder: "e.g., IL or Illinois", inputType: "text" },
  { id: "q2", prompt: "What is the name of the City?", csvColumn: "city", mode: "equals", placeholder: "e.g., Chicago", inputType: "text" },
  { id: "q3", prompt: "What is the requested bonding limit amount?", csvColumn: "bond_limit", mode: "equals", placeholder: "e.g., 50000", inputType: "number" },
  { id: "q4", prompt: "Who is requesting the bond?", csvColumn: "name", mode: "equals", placeholder: "e.g., City of Chicago", inputType: "text" },
  { id: "q5", prompt: "What effective date should the bond be issued on?", placeholder: "YYYY-MM-DD", inputType: "date" },
];

const PURCHASE_FIELDS: PurchaseField[] = [
  { id: "companyName", prompt: "Company Name", type: "text", hint: "The legal entity purchasing the bond" },
  { id: "contactName", prompt: "Contact Name", type: "text", hint: "Person we should speak with" },
  { id: "companyAddress", prompt: "Company Address", type: "address", hint: "Start typing to search an address" },
  { id: "contactPhone", prompt: "Contact Cell Phone Number", type: "tel", hint: "SMS-capable number for approval & confirmation" },
  { id: "contactEmail", prompt: "Contact Email Address", type: "email", hint: "We'll send documents and receipts here" },
];

/** ---------- Utils ---------- */
const STATE_ABBR_TO_NAME: Record<string, string> = {
  AL:"Alabama", AK:"Alaska", AZ:"Arizona", AR:"Arkansas", CA:"California", CO:"Colorado", CT:"Connecticut", DE:"Delaware", FL:"Florida", GA:"Georgia",
  HI:"Hawaii", ID:"Idaho", IL:"Illinois", IN:"Indiana", IA:"Iowa", KS:"Kansas", KY:"Kentucky", LA:"Louisiana", ME:"Maine", MD:"Maryland",
  MA:"Massachusetts", MI:"Michigan", MN:"Minnesota", MS:"Mississippi", MO:"Missouri", MT:"Montana", NE:"Nebraska", NV:"Nevada", NH:"New Hampshire",
  NJ:"New Jersey", NM:"New Mexico", NY:"New York", NC:"North Carolina", ND:"North Dakota", OH:"Ohio", OK:"Oklahoma", OR:"Oregon", PA:"Pennsylvania",
  RI:"Rhode Island", SC:"South Carolina", SD:"South Dakota", TN:"Tennessee", TX:"Texas", UT:"Utah", VT:"Vermont", VA:"Virginia", WA:"Washington",
  WV:"West Virginia", WI:"Wisconsin", WY:"Wyoming",
};
function stateFromInput(input: string): string {
  const t = (input || "").trim();
  if (/^[A-Za-z]{2}$/.test(t)) {
    const full = STATE_ABBR_TO_NAME[t.toUpperCase()];
    return full ? full : t;
  }
  return t;
}
function numeric(val: unknown): number | null {
  const n = Number(String(val ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}
function formatMoney(n: unknown): string {
  const num = numeric(n);
  if (num === null) return "—";
  return `$${num.toLocaleString()}`;
}
// Email/phone helpers
function isValidEmail(s: string) { return /^\S+@\S+\.[\w-]{2,}$/.test(String(s).trim()); }
function normalizePhone(s: string) {
  const digits = String(s || "").replace(/\D+/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  if (digits.length === 10) return "+1" + digits;
  if (/^\+\d{7,15}$/.test("+" + digits)) return "+" + digits;
  return (s || "").trim();
}
function isValidPhone(s: string) { const n = normalizePhone(s); return /^\+\d{10,15}$/.test(n); }

/** ---------- Address Autocomplete (optional) ---------- */
function AddressAutocomplete({
  value, onChange, placeholder,
}: { value: string; onChange: (e: { target: { value: string } }) => void; placeholder?: string; }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const w = typeof window !== "undefined" ? (window as any) : undefined;
    const hasPlaces = !!(w && w.google && w.google.maps && w.google.maps.places);
    if (!hasPlaces || !inputRef.current) return;
    const ac = new w.google.maps.places.Autocomplete(inputRef.current, {
      fields: ["formatted_address", "address_components"],
      types: ["address"],
      componentRestrictions: { country: ["us"] },
    });
    const listener = ac.addListener("place_changed", () => {
      const place = ac.getPlace();
      const addr = place?.formatted_address || inputRef.current!.value;
      onChange({ target: { value: addr } });
    });
    return () => listener && listener.remove && listener.remove();
  }, [onChange]);

  return (
    <Input
      ref={inputRef as any}
      value={value}
      onChange={(e) => onChange({ target: { value: (e.target as HTMLInputElement).value } })}
      placeholder={placeholder || "Start typing address"}
      className="dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-400"
    />
  );
}

/** ---------- API call (serverless) ---------- */
async function findExactBondViaApi(params: {
  state: string; city: string; bond_limit: number; name: string;
}): Promise<BondRow | null> {
  const res = await fetch("/api/query-bond", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    console.error("API error", await res.text());
    return null;
  }
  const json = await res.json();
  return json?.match ?? null;
}

/** ---------- Component ---------- */
export default function CsvChatbotExtended() {
  // qa → summary → purchase → consent → delivery → done
  const [phase, setPhase] = useState<"qa" | "summary" | "purchase" | "consent" | "delivery" | "done">("qa");

  // Q&A
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Answers>({});
  const [input, setInput] = useState("");
  const [qError, setQError] = useState("");

  // Match
  const [primary, setPrimary] = useState<BondRow | null>(null);
  const [loadingMatch, setLoadingMatch] = useState(false);

  // Purchase
  const [purchase, setPurchase] = useState<Record<string, string>>({});
  const [pStep, setPStep] = useState(0);
  const [pError, setPError] = useState("");

  // Delivery
  const [deliveryChoice, setDeliveryChoice] = useState<"text" | "email" | null>(null);
  const [deliveryValue, setDeliveryValue] = useState("");
  const [deliveryError, setDeliveryError] = useState("");

  const currentQ = phase === "qa" ? QUESTION_CONFIG[step] : null;

  // Date bounds for q5
  function todayYMD() { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
  function plusOneYearYMD() { const d=new Date(); d.setFullYear(d.getFullYear()+1); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
  const minDate = todayYMD();
  const maxDate = plusOneYearYMD();

  function validateQ5(val: string) {
    const min = new Date(minDate);
    const max = new Date(maxDate);
    const d = new Date(val);
    if (!(d instanceof Date) || isNaN(d.getTime())) return "Please choose a valid date.";
    if (d < min) return "Effective date cannot be in the past. Please select today or a future date.";
    if (d > max) return "Effective date must be within the next year.";
    return "";
  }

  function interpretForSave(q: Question, raw: string) {
    if (q.id === "q1") return stateFromInput(raw);
    if (q.id === "q3") return String(Number(String(raw).replace(/[^0-9.-]/g, "")) || raw);
    if (q.id === "q5") return raw;
    return raw;
  }

  function resetAll() {
    setPhase("qa"); setStep(0); setAnswers({}); setInput(""); setQError("");
    setPrimary(null); setLoadingMatch(false);
    setPurchase({}); setPStep(0); setPError("");
    setDeliveryChoice(null); setDeliveryValue(""); setDeliveryError("");
  }

  function submitAnswer() {
    if (!currentQ) return;
    const raw = input.trim();
    if (!raw) return;

    if (currentQ.id === "q5") {
      const err = validateQ5(raw);
      if (err) { setQError(err); return; }
      setQError("");
    }

    const val = interpretForSave(currentQ, raw);
    setAnswers(prev => ({ ...prev, [currentQ.id]: val }));
    setInput("");

    if (step + 1 < QUESTION_CONFIG.length) setStep(step + 1);
    else setPhase("summary");
  }

  function goBackQA() {
    if (step === 0) return;
    const prev = step - 1;
    const prevId = QUESTION_CONFIG[prev].id;
    setInput(answers[prevId] || "");
    setStep(prev);
    setQError("");
  }

  // Call API when entering "summary"
  useEffect(() => {
    const run = async () => {
      if (phase !== "summary") return;

      const state = stateFromInput(answers.q1 || "");
      const city = (answers.q2 || "").trim();
      const bondLimitNum = numeric(answers.q3);
      const partyName = (answers.q4 || "").trim();

      if (!state || !city || !partyName || bondLimitNum === null) {
        setPrimary(null);
        return;
      }

      setLoadingMatch(true);
      const row = await findExactBondViaApi({
        state, city, bond_limit: bondLimitNum, name: partyName,
      });
      setPrimary(row);
      setLoadingMatch(false);
    };
    run();
  }, [phase, answers.q1, answers.q2, answers.q3, answers.q4]);

  const premiumDisplay = useMemo(() => (primary ? formatMoney(primary.premium ?? "—") : "—"), [primary]);

  /** ---------- UI ---------- */
  return (
    <div className="min-h-screen sm:p-6 p-4 bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-950 text-slate-800 dark:text-slate-200">
      <div className="mx-auto w-full max-w-6xl grid gap-4 sm:gap-6">
        {/* Header */}
        <header className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Sparkles className="h-6 w-6 text-slate-700 dark:text-slate-300" />
            <h1 className="text-xl sm:text-2xl font-semibold">Bond Chatbot</h1>
          </div>
        </header>

        {/* Q&A */}
        {phase === "qa" && (
          <Card className="dark:border-slate-700 dark:bg-slate-900/60">
            <CardContent className="sm:p-6 p-4 space-y-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="font-semibold">{QUESTION_CONFIG[step]?.prompt}</div>
                <Badge variant="outline">{step + 1} / {QUESTION_CONFIG.length}</Badge>
              </div>
              <Input
                value={input}
                onChange={(e) => setInput((e.target as HTMLInputElement).value)}
                type={QUESTION_CONFIG[step]?.inputType}
                placeholder={QUESTION_CONFIG[step]?.placeholder}
                min={QUESTION_CONFIG[step]?.id === "q5" ? minDate : undefined}
                max={QUESTION_CONFIG[step]?.id === "q5" ? maxDate : undefined}
                onKeyDown={(e) => e.key === "Enter" && submitAnswer()}
                className="dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-400"
              />
              {qError && <div className="text-red-600 dark:text-red-400 text-sm">{qError}</div>}
              <div className="flex gap-2 flex-wrap">
                <Button onClick={submitAnswer}>Next</Button>
                <Button variant="secondary" onClick={goBackQA} disabled={step === 0}>Back</Button>
                <Button
                  variant="secondary"
                  className="ml-auto"
                  onClick={() => { setStep(0); setAnswers({}); setInput(""); setQError(""); }}
                >
                  <RotateCcw className="h-4 w-4" /> Reset
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Summary / Inquiry */}
        {phase === "summary" && (
          <Card className="dark:border-slate-700 dark:bg-slate-900/60">
            <CardContent className="sm:p-6 p-4 space-y-4">
              {loadingMatch ? (
                <div className="text-slate-600 dark:text-slate-300 flex items-center gap-2">
                  <FileSearch className="h-5 w-5" /> Searching for an exact match…
                </div>
              ) : primary ? (
                <>
                  <div className="font-semibold text-lg">Bond Summary</div>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div>Name: {String(primary.name ?? "")}</div>
                      <Button size="sm" variant="secondary" onClick={() => { setPhase("qa"); setStep(3); setInput(answers.q4 || ""); }}>Edit</Button>
                    </div>
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div>Location: {String(primary.city ?? "")}, {String(primary.state ?? "")}</div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="secondary" onClick={() => { setPhase("qa"); setStep(1); setInput(answers.q2 || ""); }}>Edit City</Button>
                        <Button size="sm" variant="secondary" onClick={() => { setPhase("qa"); setStep(0); setInput(answers.q1 || ""); }}>Edit State</Button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div>Limit: {formatMoney(primary.bond_limit)}</div>
                      <Button size="sm" variant="secondary" onClick={() => { setPhase("qa"); setStep(2); setInput(answers.q3 || ""); }}>Edit</Button>
                    </div>
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div>Effective Date: {answers.q5}</div>
                      <Button size="sm" variant="secondary" onClick={() => { setPhase("qa"); setStep(4); setInput(answers.q5 || ""); }}>Edit</Button>
                    </div>
                    <div>Premium: {premiumDisplay}</div>
                  </div>

                  <div className="mt-4">
                    <div className="font-semibold mb-2">Have you reviewed enough information to make a decision?</div>
                    <div className="flex gap-2 flex-wrap">
                      <Button onClick={() => setPhase("purchase")}>Yes</Button>
                      <Button variant="secondary" onClick={() => setPhase("qa")}>No</Button>
                      <Button variant="secondary" className="ml-auto" onClick={() => setPhase("qa")}>Back</Button>
                    </div>
                  </div>
                </>
              ) : (
                <div
                  className="rounded-xl border border-dashed p-3 sm:p-4 dark:border-slate-700"
                  style={{ borderColor: "rgb(203 213 225)" }}
                >
                  <div className="text-sm">No exact match found. We’ll route this inquiry to a service rep.</div>
                  <pre className="text-xs sm:text-sm mt-3 overflow-auto">{JSON.stringify(answers, null, 2)}</pre>
                  <div className="mt-3">
                    <Button variant="secondary" onClick={() => setPhase("qa")}>Back</Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Purchase */}
        {phase === "purchase" && (
          <Card className="dark:border-slate-700 dark:bg-slate-900/60">
            <CardContent className="sm:p-6 p-4 space-y-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="font-semibold">Purchase Information</div>
                <Badge variant="outline">{pStep + 1} / {PURCHASE_FIELDS.length}</Badge>
              </div>
              <label className="text-sm">{PURCHASE_FIELDS[pStep].prompt}</label>
              {PURCHASE_FIELDS[pStep].type === "address" ? (
                <AddressAutocomplete
                  value={purchase[PURCHASE_FIELDS[pStep].id] || ""}
                  onChange={(e) => setPurchase(p => ({ ...p, [PURCHASE_FIELDS[pStep].id]: e.target.value }))}
                  placeholder={PURCHASE_FIELDS[pStep].hint}
                />
              ) : (
                <Input
                  type={
                    PURCHASE_FIELDS[pStep].type === "tel" ? "tel" :
                    PURCHASE_FIELDS[pStep].type === "email" ? "email" : "text"
                  }
                  value={purchase[PURCHASE_FIELDS[pStep].id] || ""}
                  onChange={(e) => setPurchase(p => ({ ...p, [PURCHASE_FIELDS[pStep].id]: (e.target as HTMLInputElement).value }))}
                  placeholder={PURCHASE_FIELDS[pStep].hint || PURCHASE_FIELDS[pStep].prompt}
                  className="dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-400"
                />
              )}
              {pError && <div className="text-red-600 dark:text-red-400 text-sm">{pError}</div>}
              <div className="flex gap-2 flex-wrap">
                <Button onClick={() => {
                  const field = PURCHASE_FIELDS[pStep];
                  const val = (purchase[field.id] || "").toString().trim();
                  if (!val) { setPError(`${field.prompt} is required.`); return; }
                  if (field.id === "contactEmail" && !isValidEmail(val)) { setPError("Please enter a valid email address."); return; }
                  if (field.id === "contactPhone" && !isValidPhone(val)) { setPError("Please enter a valid mobile phone number (SMS-capable)."); return; }
                  if (field.id === "contactPhone") { setPurchase(p => ({ ...p, [field.id]: normalizePhone(val) })); }
                  setPError("");
                  if (pStep + 1 < PURCHASE_FIELDS.length) setPStep(pStep + 1); else setPhase("consent");
                }}>Next</Button>
                <Button variant="secondary" onClick={() => { setPError(""); if (pStep === 0) { setPhase("summary"); } else { setPStep(pStep - 1); } }}>Back</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Consent */}
        {phase === "consent" && (
          <Card className="dark:border-slate-700 dark:bg-slate-900/60">
            <CardContent className="sm:p-6 p-4 space-y-3">
              <div className="font-semibold">Text & Call Consent</div>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                By providing your phone number, you consent to receive calls and text messages related to your bond and related services, including payment and renewal reminders. Message and data rates may apply. Consent is not a condition of purchase. You can opt out at any time by replying STOP.
              </p>
              <div className="flex gap-2 flex-wrap">
                <Button onClick={() => setPhase("delivery")}>I Agree</Button>
                <Button variant="secondary" onClick={() => setPhase("delivery")}>I Do Not Agree</Button>
                <Button variant="secondary" className="ml-auto" onClick={() => setPhase("purchase")}>Back</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Delivery */}
        {phase === "delivery" && (
          <Card className="dark:border-slate-700 dark:bg-slate-900/60">
            <CardContent className="sm:p-6 p-4 space-y-4">
              {!deliveryChoice ? (
                <>
                  <div className="font-semibold">Delivery Preference</div>
                  <p>Would you like the secure payment link sent via text or email?</p>
                  <div className="flex gap-2 flex-wrap">
                    <Button onClick={() => setDeliveryChoice("text")}>Text</Button>
                    <Button onClick={() => setDeliveryChoice("email")}>Email</Button>
                    <Button variant="secondary" className="ml-auto" onClick={() => setPhase("consent")}>Back</Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="font-semibold">Confirm {deliveryChoice === "text" ? "Mobile Number" : "Email Address"}</div>
                  <p className="text-sm text-slate-600 dark:text-slate-300">
                    We will send the secure payment link to the {deliveryChoice === "text" ? "mobile number" : "email address"} below. Update it if needed and submit.
                  </p>
                  <Input
                    type={deliveryChoice === "text" ? "tel" : "email"}
                    placeholder={deliveryChoice === "text" ? (purchase["contactPhone"] || "Enter mobile number") : (purchase["contactEmail"] || "Enter email address")}
                    value={deliveryValue}
                    onChange={(e) => setDeliveryValue((e.target as HTMLInputElement).value)}
                    className="dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-400"
                  />
                  {deliveryError && <div className="text-red-600 dark:text-red-400 text-sm">{deliveryError}</div>}
                  <div className="flex gap-2 flex-wrap">
                    <Button onClick={() => {
                      if (deliveryChoice === "text") {
                        const v = deliveryValue || purchase["contactPhone"] || "";
                        if (!isValidPhone(v)) { setDeliveryError("Please enter a valid mobile phone number."); return; }
                      }
                      if (deliveryChoice === "email") {
                        const v = deliveryValue || purchase["contactEmail"] || "";
                        if (!isValidEmail(v)) { setDeliveryError("Please enter a valid email address."); return; }
                      }
                      setDeliveryError("");
                      setPhase("done");
                    }}>Submit</Button>
                    <Button variant="secondary" onClick={() => setDeliveryChoice(null)}>Back</Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* Done */}
        {phase === "done" && (
          <Card className="dark:border-slate-700 dark:bg-slate-900/60">
            <CardContent className="sm:p-6 p-4 space-y-3">
              <div className="font-semibold text-lg">Process Complete</div>
              <p>The secure payment link will be sent via {deliveryChoice || "email"} to {deliveryValue}.</p>
              <Button variant="secondary" onClick={resetAll}><RotateCcw className="h-4 w-4" /> Start Over</Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
