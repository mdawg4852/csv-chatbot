import { useMemo, useRef, useState, useEffect } from "react";
import type { ChangeEvent } from "react";
import { Card, CardContent, Button, Input, Badge } from "./ui";
import { Upload, RotateCcw, FileSearch, Sparkles } from "lucide-react";
import Papa from "papaparse";

// --- Types & shims ---
type Row = Record<string, string>;
type ParsedCsv = { rows: Row[]; headers: string[] };
type Answers = Record<string, string>;
type Phase = "qa" | "summary" | "purchase" | "consent" | "delivery" | "done";

interface ContactInfo {
  companyName: string;
  contactName: string;
  companyAddress: string;
  contactPhone: string;
  contactEmail: string;
  consent?: boolean;
}

declare global {
  interface Window {
    google?: any;
  }
}

// --- Question config typing ---
type Mode = "equals" | "contains" | "gte" | "lte";
type Question = {
  id: "q1" | "q2" | "q3" | "q4" | "q5";
  prompt: string;
  csvColumn?: string; // undefined for q5 (date, not in CSV)
  mode?: Mode;
  placeholder?: string;
  inputType: "text" | "number" | "date";
};

/**
 * CSV Chatbot (text-only) — decision & purchase flow + back buttons + validation + address autocomplete
 * ---------------------------------------------------------------------------------------------------
 * - Upload CSV
 * - Ask 5 questions (text/date input)
 * - Exact match on state, city, bond_limit, name (with state abbr → full name)
 * - Q5 date restricted: today .. next 1 year (no past dates)
 * - Summary with inline **Edit** buttons
 * - Purchase step-by-step with validation
 * - Address supports Google Places Autocomplete (optional)
 * - Consent → Delivery preference → Confirm destination → Done
 * - If no match: creates inquiry payload for service team
 */
const QUESTION_CONFIG: Question[] = [
  { id: "q1", prompt: "Which state is the bond located in?", csvColumn: "state", mode: "equals", placeholder: "e.g., IL or Illinois", inputType: "text" },
  { id: "q2", prompt: "What is the name of the City?", csvColumn: "city", mode: "equals", placeholder: "e.g., Chicago", inputType: "text" },
  { id: "q3", prompt: "What is the requested bonding limit amount?", csvColumn: "bond_limit", mode: "equals", placeholder: "e.g., 50000", inputType: "number" },
  { id: "q4", prompt: "Who is requesting the bond?", csvColumn: "name", mode: "equals", placeholder: "e.g., City of Chicago", inputType: "text" },
  { id: "q5", prompt: "What effective date should the bond be issued on?", inputType: "date", placeholder: "YYYY-MM-DD" },
];

const PURCHASE_FIELDS: Array<{ id: keyof ContactInfo; prompt: string; type: "text" | "tel" | "email" | "address"; hint?: string; }> = [
  { id: "companyName", prompt: "Company Name", type: "text", hint: "The legal entity purchasing the bond" },
  { id: "contactName", prompt: "Contact Name", type: "text", hint: "Person we should speak with" },
  { id: "companyAddress", prompt: "Company Address", type: "address", hint: "Start typing to search an address" },
  { id: "contactPhone", prompt: "Contact Cell Phone Number", type: "tel", hint: "SMS-capable number for approval & confirmation" },
  { id: "contactEmail", prompt: "Contact Email Address", type: "email", hint: "We'll send documents and receipts here" },
];

// --- Utility functions ---
// Convert "IL" -> "Illinois"
function stateFromInput(input: string): string {
  const states: Record<string, string> = {
    AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
    CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
    HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
    KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
    MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
    MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire",
    NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina",
    ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
    RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee",
    TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
    WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  };
  const key = input.trim().toUpperCase();
  return states[key] || input.trim();
}

// Normalize
function normalize(v: string) { return (v ?? "").toString().trim().toLowerCase(); }

// Interpret answer by question
function interpretAnswer(qid: Question["id"], raw: string): string {
  if (qid === "q1") return stateFromInput(raw);
  if (qid === "q3") return String(Number(String(raw).replace(/[^0-9.-]/g, "")) || raw);
  if (qid === "q5") return raw; // date string as-is
  return raw;
}

// Exact match helper
function matches(
  row: Row,
  q: { id: Question["id"]; csvColumn?: string; mode?: Mode },
  answer: string
): boolean {
  if (!q.csvColumn) return true; // q5 has no CSV column
  const raw = row[q.csvColumn];
  if (raw === undefined) return false;
  const ans = interpretAnswer(q.id, answer);
  const a = normalize(ans);
  const rv = normalize(String(raw));
  // Per requirements: exact match
  return rv === a;
}

// Strict match across all CSV-mapped questions
function strictMatch(rows: Row[], answers: Answers): Row[] {
  const qs = QUESTION_CONFIG.filter(q => q.csvColumn);
  return rows.filter(row => qs.every(q => matches(row, q, answers[q.id] || "")));
}

// CSV parsing
function parseCsv(file: File): Promise<ParsedCsv> {
  return new Promise((resolve, reject) => {
    Papa.parse<Row>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const rows = (results.data || []).filter(Boolean);
        const headers = results.meta?.fields || Object.keys(rows[0] || {});
        resolve({ rows, headers });
      },
      error: reject,
    });
  });
}

// Display helpers
function formatMoney(n: string | number) {
  const num = Number(String(n).replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(num)) return "—";
  return `$${num.toLocaleString()}`;
}

// Validation
function isValidEmail(s: string) {
  return /^\S+@\S+\.[\w-]{2,}$/.test(String(s).trim());
}
function normalizePhone(s: string) {
  const digits = String(s || "").replace(/\D+/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  if (digits.length === 10) return "+1" + digits;
  if (/^\+\d{7,15}$/.test("+" + digits)) return "+" + digits; // generic fallback
  return (s || "").trim();
}
function isValidPhone(s: string) {
  const n = normalizePhone(s);
  return /^\+\d{10,15}$/.test(n);
}

// ---------- Address Autocomplete (Google Places) ----------
function AddressAutocomplete(props: {
  value: string;
  onChange: (e: { target: { value: string } }) => void;
  placeholder?: string;
}) {
  const { value, onChange, placeholder } = props;
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const w = typeof window !== "undefined" ? window : undefined;
    const hasPlaces = !!(w && w.google && w.google.maps && w.google.maps.places);
    if (!hasPlaces || !inputRef.current) return;

    const ac = new w.google.maps.places.Autocomplete(inputRef.current, {
      fields: ["formatted_address", "address_components"],
      types: ["address"],
      componentRestrictions: { country: ["us"] },
    });
    const listener = ac.addListener("place_changed", () => {
      const place = ac.getPlace();
      const addr = place?.formatted_address || inputRef.current?.value || "";
      onChange({ target: { value: addr } });
    });
    return () => {
      if (listener && typeof listener.remove === "function") listener.remove();
    };
  }, [onChange]);

  return (
    <Input
      ref={inputRef}
      value={value}
      onChange={(e) => onChange({ target: { value: (e.target as HTMLInputElement).value } })}
      placeholder={placeholder || "Start typing address"}
    />
  );
}

// ---------- Inquiry block (shown when no exact match) ----------
const InquiryBlock: React.FC<{ answers: Answers }> = ({ answers }) => (
  <div style={{ border: "1px dashed #cbd5e1", padding: 12, borderRadius: 12 }}>
    <div className="text-sm">No exact match found. We’ll route this inquiry to a service rep.</div>
    <pre style={{ fontSize: 12, marginTop: 8 }}>{JSON.stringify(answers, null, 2)}</pre>
  </div>
);

// ---------- Main Component ----------
export default function CsvChatbotExtended() {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [csv, setCsv] = useState<ParsedCsv | null>(null);

  const [phase, setPhase] = useState<Phase>("qa"); // qa → summary → purchase → consent → delivery → done

  // QA state
  const [step, setStep] = useState<number>(0);
  const [answers, setAnswers] = useState<Answers>({});
  const [input, setInput] = useState<string>("");
  const [qError, setQError] = useState<string>("");

  // Purchase state
  const [purchase, setPurchase] = useState<Partial<ContactInfo>>({});
  const [pStep, setPStep] = useState<number>(0);
  const [pError, setPError] = useState<string>("");

  // Delivery state
  const [deliveryChoice, setDeliveryChoice] = useState<"text" | "email" | null>(null);
  const [deliveryValue, setDeliveryValue] = useState<string>("");
  const [deliveryError, setDeliveryError] = useState<string>("");

  const exactMatches = useMemo<Row[]>(() => (csv ? strictMatch(csv.rows, answers) : []), [csv, answers]);
  const primary = exactMatches[0] || null;
  const premiumDisplay = primary ? formatMoney(primary.premium) : "—";

  const currentQ = phase === "qa" ? QUESTION_CONFIG[step] : null;

  function resetAll() {
    setPhase("qa"); setStep(0); setAnswers({}); setInput(""); setQError("");
    setPurchase({}); setPStep(0); setPError("");
    setDeliveryChoice(null); setDeliveryValue(""); setDeliveryError("");
  }

  // Dates for q5
  function todayYMD() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  function plusOneYearYMD() {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
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

  function submitAnswer() {
    if (!currentQ) return;
    const raw = input.trim();
    if (!raw) return;

    if (currentQ.id === "q5") {
      const err = validateQ5(raw);
      if (err) { setQError(err); return; }
      setQError("");
    }

    const val = interpretAnswer(currentQ.id, raw);
    setAnswers(prev => ({ ...prev, [currentQ.id]: val }));
    setInput("");
    if (step + 1 < QUESTION_CONFIG.length) setStep(step + 1);
    else setPhase("summary");
  }

  function goBackQA() {
    if (step === 0) return;
    const prevStep = step - 1;
    const prevId = QUESTION_CONFIG[prevStep].id;
    setInput(answers[prevId] || "");
    setStep(prevStep);
    setQError("");
  }

  // Purchase step flow
  const curField = PURCHASE_FIELDS[pStep];
  function nextPurchase() {
    if (!curField) return;
    const currentVal = ((purchase as any)[curField.id] || "").toString().trim();

    if (!currentVal) { setPError(`${curField.prompt} is required.`); return; }
    if (curField.id === "contactEmail" && !isValidEmail(currentVal)) { setPError("Please enter a valid email address."); return; }
    if (curField.id === "contactPhone" && !isValidPhone(currentVal)) { setPError("Please enter a valid mobile phone number (SMS-capable)."); return; }

    if (curField.id === "contactPhone") {
      setPurchase(p => ({ ...p, [curField.id]: normalizePhone(currentVal) } as Partial<ContactInfo>));
    }

    setPError("");
    if (pStep + 1 < PURCHASE_FIELDS.length) setPStep(pStep + 1);
    else setPhase("consent");
  }
  function backPurchase() {
    setPError("");
    if (pStep === 0) { setPhase("summary"); return; }
    setPStep(pStep - 1);
  }

  const disclaimer =
    "By providing your phone number, you consent to receive calls and text messages related to your bond and related services, including payment and renewal reminders. Message and data rates may apply. Consent is not a condition of purchase. You can opt out at any time by replying STOP.";

  function chooseDelivery(choice: "text" | "email") {
    setDeliveryChoice(choice);
    const prefill = choice === "text" ? ((purchase as any).contactPhone || "") : ((purchase as any).contactEmail || "");
    setDeliveryValue(prefill);
    setDeliveryError("");
  }

  function submitDelivery() {
    if (deliveryChoice === "text") {
      const v = deliveryValue || (purchase as any).contactPhone;
      if (!isValidPhone(v)) { setDeliveryError("Please enter a valid mobile phone number."); return; }
      setDeliveryError("");
      setPhase("done");
      return;
    }
    if (deliveryChoice === "email") {
      const v = deliveryValue || (purchase as any).contactEmail;
      if (!isValidEmail(v)) { setDeliveryError("Please enter a valid email address."); return; }
      setDeliveryError("");
      setPhase("done");
      return;
    }
  }

  // File input handler
  const onFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const parsed = await parseCsv(f);
    setCsv(parsed);
    resetAll();
  };

  return (
    <div className="min-h-screen p-6 bg-gradient-to-b from-slate-50 to-slate-100">
      <div className="max-w-6xl mx-auto grid gap-6">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Sparkles className="h-6 w-6" />
            <h1 className="text-2xl font-semibold">CSV Chatbot</h1>
          </div>
          <div className="flex items-center gap-2">
            <Input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              onChange={onFileChange}
              className="max-w-xs"
            />
            <Button variant="secondary" onClick={() => fileRef.current?.click()} className="gap-2">
              <Upload className="h-4 w-4" /> Upload CSV
            </Button>
          </div>
        </header>

        {!csv && (
          <Card className="border-dashed">
            <CardContent className="p-8 text-center">
              <FileSearch className="mx-auto h-10 w-10 mb-3" />
              <p className="text-slate-600">
                Upload a CSV to begin. Include headers: <code>state</code>, <code>city</code>, <code>bond_limit</code>, <code>name</code>, optional <code>premium</code>.
              </p>
            </CardContent>
          </Card>
        )}

        {csv && phase === "qa" && currentQ && (
          <Card>
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div className="font-semibold">{currentQ.prompt}</div>
                <Badge variant="outline">{step + 1} / {QUESTION_CONFIG.length}</Badge>
              </div>
              <Input
                value={input}
                onChange={(e) => setInput((e.target as HTMLInputElement).value)}
                type={currentQ.inputType}
                placeholder={currentQ.placeholder}
                min={currentQ.id === "q5" ? minDate : undefined}
                max={currentQ.id === "q5" ? maxDate : undefined}
                onKeyDown={(e) => e.key === "Enter" && submitAnswer()}
              />
              {qError && <div className="text-red-600 text-sm">{qError}</div>}
              <div className="flex gap-2">
                <Button onClick={submitAnswer}>Next</Button>
                <Button
                  variant="secondary"
                  onClick={goBackQA}
                  disabled={step === 0}
                >
                  Back
                </Button>
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

        {csv && phase === "summary" && (
          <Card>
            <CardContent className="p-6 space-y-4">
              {primary ? (
                <>
                  <div className="font-semibold text-lg">Bond Summary</div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div>Name: {primary.name}</div>
                      <Button size="sm" variant="secondary" onClick={() => { setPhase("qa"); setStep(3); setInput(answers.q4 || ""); }}>Edit</Button>
                    </div>
                    <div className="flex items-center justify-between">
                      <div>Location: {primary.city}, {primary.state}</div>
                      <Button size="sm" variant="secondary" onClick={() => { setPhase("qa"); setStep(1); setInput(answers.q2 || ""); }}>Edit</Button>
                    </div>
                    <div className="flex items-center justify-between">
                      <div>Limit: {formatMoney(primary.bond_limit)}</div>
                      <Button size="sm" variant="secondary" onClick={() => { setPhase("qa"); setStep(2); setInput(answers.q3 || ""); }}>Edit</Button>
                    </div>
                    <div className="flex items-center justify-between">
                      <div>Effective Date: {answers.q5}</div>
                      <Button size="sm" variant="secondary" onClick={() => { setPhase("qa"); setStep(4); setInput(answers.q5 || ""); }}>Edit</Button>
                    </div>
                    <div>Premium: {premiumDisplay}</div>
                  </div>

                  <div className="mt-4">
                    <div className="font-semibold mb-2">Have you reviewed enough information to make a decision?</div>
                    <div className="flex gap-2">
                      <Button onClick={() => setPhase("purchase")}>Yes</Button>
                      <Button variant="secondary" onClick={() => setPhase("qa")}>No</Button>
                      <Button variant="secondary" className="ml-auto" onClick={() => setPhase("qa")}>Back</Button>
                    </div>
                  </div>
                </>
              ) : (
                <InquiryBlock answers={answers} />
              )}
            </CardContent>
          </Card>
        )}

        {csv && phase === "purchase" && (
          <Card>
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div className="font-semibold">Purchase Information</div>
                <Badge variant="outline">{pStep + 1} / {PURCHASE_FIELDS.length}</Badge>
              </div>
              <label className="text-sm">{curField?.prompt}</label>
              {curField?.type === "address" ? (
                <AddressAutocomplete
                  value={String(((purchase as any)[curField.id] || ""))}
                  onChange={(e) => setPurchase(p => ({ ...p, [curField.id]: e.target.value } as Partial<ContactInfo>))}
                  placeholder={curField.hint}
                />
              ) : (
                <Input
                  type={curField?.type === "tel" ? "tel" : (curField?.type === "email" ? "email" : "text")}
                  value={String(((purchase as any)[curField!.id] || ""))}
                  onChange={(e) => setPurchase(p => ({ ...p, [curField!.id]: (e.target as HTMLInputElement).value } as Partial<ContactInfo>))}
                  placeholder={curField?.hint || curField?.prompt}
                />
              )}
              {pError && <div className="text-red-600 text-sm">{pError}</div>}
              <div className="flex gap-2">
                <Button onClick={nextPurchase}>Next</Button>
                <Button variant="secondary" onClick={backPurchase}>Back</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {csv && phase === "consent" && (
          <Card>
            <CardContent className="p-6 space-y-3">
              <div className="font-semibold">Text & Call Consent</div>
              <p className="text-sm text-slate-600">{disclaimer}</p>
              <div className="flex gap-2">
                <Button onClick={() => setPhase("delivery")}>I Agree</Button>
                <Button variant="secondary" onClick={() => setPhase("delivery")}>I Do Not Agree</Button>
                <Button variant="secondary" className="ml-auto" onClick={() => { setPhase("purchase"); }}>Back</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {csv && phase === "delivery" && (
          <Card>
            <CardContent className="p-6 space-y-4">
              {!deliveryChoice ? (
                <>
                  <div className="font-semibold">Delivery Preference</div>
                  <p>Would you like the secure payment link sent via text or email?</p>
                  <div className="flex gap-2">
                    <Button onClick={() => chooseDelivery("text")}>Text</Button>
                    <Button onClick={() => chooseDelivery("email")}>Email</Button>
                    <Button variant="secondary" className="ml-auto" onClick={() => setPhase("consent")}>Back</Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="font-semibold">Confirm {deliveryChoice === "text" ? "Mobile Number" : "Email Address"}</div>
                  <p className="text-sm text-slate-600">We will send the secure payment link to the {deliveryChoice === "text" ? "mobile number" : "email address"} below. Update it if needed and submit.</p>
                  <Input
                    type={deliveryChoice === "text" ? "tel" : "email"}
                    placeholder={deliveryChoice === "text"
                      ? ((purchase as any).contactPhone || "Enter mobile number")
                      : ((purchase as any).contactEmail || "Enter email address")}
                    value={deliveryValue}
                    onChange={(e) => setDeliveryValue((e.target as HTMLInputElement).value)}
                  />
                  {deliveryError && <div className="text-red-600 text-sm">{deliveryError}</div>}
                  <div className="flex gap-2">
                    <Button onClick={submitDelivery}>Submit</Button>
                    <Button variant="secondary" onClick={() => setDeliveryChoice(null)}>Back</Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {csv && phase === "done" && (
          <Card>
            <CardContent className="p-6 space-y-3">
              <div className="font-semibold text-lg">Process Complete</div>
              <p>
                The secure payment link will be sent via <strong>{deliveryChoice || "email"}</strong> to{" "}
                <strong>{deliveryValue}</strong>.
              </p>
              <Button
                variant="secondary"
                onClick={() => {
                  setPhase("qa");
                  setStep(0);
                  setAnswers({});
                  setInput("");
                  setQError("");
                  setPurchase({});
                  setPStep(0);
                  setPError("");
                  setDeliveryChoice(null);
                  setDeliveryValue("");
                  setDeliveryError("");
                }}
              >
                <RotateCcw className="h-4 w-4" /> Start Over
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
