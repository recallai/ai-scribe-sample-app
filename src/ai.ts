import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { Output, generateText } from "ai";
import type { LanguageModel } from "ai";
import { z } from "zod";
import type { Config } from "./config";
import type {
  ClinicalNote,
  NoteFormat,
  NoteSection,
  TranscriptUtterance,
  Visit,
} from "./visits";

export type NoteInput = {
  format: NoteFormat;
  transcript: TranscriptUtterance[];
  patientName: string;
};

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type ChatInput = {
  question: string;
  history: ChatMessage[];
  transcript: TranscriptUtterance[];
  note: ClinicalNote | null;
};

export type ChatAnswer = { answer: string; timestamps: number[] };

export type AiClient = {
  generateNote(input: NoteInput): Promise<ClinicalNote>;
  answer(input: ChatInput): Promise<ChatAnswer>;
};

// Each note format is just an ordered list of sections. The model fills them in
// from the transcript; the headings and their order come from here, not the LLM.
type SectionTemplate = { key: string; heading: string; guidance: string };

export const NOTE_TEMPLATES: Record<NoteFormat, { label: string; sections: SectionTemplate[] }> = {
  soap: {
    label: "SOAP",
    sections: [
      { key: "subjective", heading: "Subjective", guidance: "What the patient reports: symptoms, history, concerns, in their own words." },
      { key: "objective", heading: "Objective", guidance: "Measurable findings stated in the visit: vitals, exam findings, results." },
      { key: "assessment", heading: "Assessment", guidance: "The clinician's assessment or working diagnosis." },
      { key: "plan", heading: "Plan", guidance: "Next steps: medications, tests, referrals, follow-up, patient instructions." },
    ],
  },
  dap: {
    label: "DAP",
    sections: [
      { key: "data", heading: "Data", guidance: "Both what the patient reported and objective findings observed during the visit." },
      { key: "assessment", heading: "Assessment", guidance: "The clinician's interpretation of the data and working diagnosis." },
      { key: "plan", heading: "Plan", guidance: "Next steps: medications, tests, referrals, follow-up, patient instructions." },
    ],
  },
  birp: {
    label: "BIRP",
    sections: [
      { key: "behavior", heading: "Behavior", guidance: "What the patient presented with and reported, plus observed behavior." },
      { key: "intervention", heading: "Intervention", guidance: "What the clinician did or advised during the visit." },
      { key: "response", heading: "Response", guidance: "How the patient responded to the intervention or discussion." },
      { key: "plan", heading: "Plan", guidance: "Next steps: medications, tests, referrals, follow-up, patient instructions." },
    ],
  },
};

export const NOTE_FORMATS = Object.keys(NOTE_TEMPLATES) as NoteFormat[];

const CALL_TIMEOUT_MS = 120_000;

export function createAiClient(config: Config): AiClient {
  const model = resolveModel(config);

  return {
    async generateNote({ format, transcript, patientName }) {
      const template = NOTE_TEMPLATES[format];
      const instructions = [
        `You are a medical scribe drafting a ${template.label} note from a telehealth visit transcript.`,
        patientName ? `Patient: ${patientName}.` : "Patient name was not provided. Do not invent one.",
        "Participant names come from the meeting platform. Do not infer a clinical role from a name alone.",
        "Use only information stated in the transcript. Do not invent findings, vitals, or diagnoses.",
        "Write in concise clinical prose. If a section has nothing to record, write \"Not discussed.\"",
        "This is a draft for clinician review, not a final medical record.",
        "Fill each field:",
        ...template.sections.map((s) => `- ${s.key}: ${s.guidance}`),
      ].join("\n");

      const { output } = await generateText({
        model,
        instructions,
        prompt: `Transcript:\n\n${transcriptToDialogue(transcript)}`,
        // `name` and `description` are passed to the provider alongside the
        // schema, which helps it understand what it is filling in.
        output: Output.object({
          name: `${template.label}Note`,
          description: `A ${template.label} clinical note for one telehealth visit.`,
          schema: schemaFor(format),
        }),
        maxOutputTokens: 4000,
        abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });

      return {
        format,
        sections: toSections(format, output as Record<string, unknown>),
        model: config.aiModel,
        generatedAt: new Date().toISOString(),
      };
    },

    async answer({ question, history, transcript, note }) {
      const context = [
        "Transcript:",
        transcriptToDialogue(transcript),
        "",
        note ? `Draft ${note.format.toUpperCase()} note:\n${noteToText(note)}` : "No note has been generated yet.",
      ].join("\n");

      const { output } = await generateText({
        model,
        instructions: [
          "You answer a clinician's questions about a single telehealth visit.",
          "Use only the transcript and note below. If the answer is not in them, say so plainly.",
          "Be concise. Include up to three transcript start times that directly support the answer.",
          "",
          context,
        ].join("\n"),
        messages: [...history, { role: "user", content: question }],
        output: Output.object({
          name: "GroundedVisitAnswer",
          description: "A concise answer and the transcript times that support it.",
          schema: z.object({
            answer: z.string(),
            timestamps: z.array(z.number().nonnegative()).max(3),
          }),
        }),
        maxOutputTokens: 1000,
        abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });

      return {
        answer: output.answer.trim(),
        timestamps: output.timestamps.filter(Number.isFinite),
      };
    },
  };
}

// Generates a note without failing the completed visit when the model call fails.
export async function runScribe(visit: Visit, ai: AiClient): Promise<void> {
  if (!visit.transcript) return;

  try {
    visit.note = await ai.generateNote({
      format: visit.noteFormat,
      transcript: visit.transcript,
      patientName: visit.patientName,
    });
    visit.aiError = null;
  } catch (error) {
    visit.aiError = {
      stage: "note",
      message: error instanceof Error ? error.message : String(error),
    };
    console.error("note generation failed", { visitId: visit.id, message: visit.aiError.message });
  }
}

export function isNoteFormat(value: unknown): value is NoteFormat {
  return typeof value === "string" && (NOTE_FORMATS as string[]).includes(value);
}

// Render Recall's participant names as a plain dialogue the model can read.
export function transcriptToDialogue(transcript: TranscriptUtterance[]): string {
  if (transcript.length === 0) return "(no speech was transcribed)";
  return transcript
    .map((line) => {
      const at = typeof line.startSeconds === "number" ? ` @ ${line.startSeconds.toFixed(1)}s` : "";
      return `[${line.speaker ?? "Unknown speaker"}${at}] ${line.text}`;
    })
    .join("\n");
}

export function noteToText(note: ClinicalNote): string {
  return note.sections.map((s) => `${s.heading}:\n${s.content}`).join("\n\n");
}

function schemaFor(format: NoteFormat) {
  const shape: Record<string, z.ZodString> = {};
  for (const section of NOTE_TEMPLATES[format].sections) {
    shape[section.key] = z.string();
  }
  return z.object(shape);
}

function toSections(format: NoteFormat, object: Record<string, unknown>): NoteSection[] {
  return NOTE_TEMPLATES[format].sections.map((section) => ({
    heading: section.heading,
    content: String(object[section.key] ?? "").trim() || "Not discussed.",
  }));
}

function resolveModel(config: Config): LanguageModel {
  switch (config.aiProvider) {
    case "openai":
      return createOpenAI({ apiKey: config.aiApiKey })(config.aiModel);
    default:
      return createAnthropic({ apiKey: config.aiApiKey })(config.aiModel);
  }
}
