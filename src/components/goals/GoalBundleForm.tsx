import React, { useState } from "react";
import { Plus, Trash2, Target, PenLine, Send } from "lucide-react";
import { FormField } from "@/components/shared/FormField";
import { SubmitButton } from "@/components/shared/SubmitButton";
import { ServerError } from "@/components/shared/ServerError";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { MeasureType } from "@/types";

interface Props {
  serverError?: string | null;
}

interface GoalRowState {
  description: string;
  measureType: MeasureType;
  targetValue: string;
}

interface RowErrors {
  description?: string;
  targetValue?: string;
}

const MAX_GOALS = 20;

function emptyRow(): GoalRowState {
  return { description: "", measureType: "numeric", targetValue: "" };
}

export default function GoalBundleForm({ serverError }: Props) {
  const [rows, setRows] = useState<GoalRowState[]>([emptyRow()]);
  const [errors, setErrors] = useState<Partial<Record<number, RowErrors>>>({});

  function updateRow(index: number, patch: Partial<GoalRowState>) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function addRow() {
    setRows((prev) => (prev.length >= MAX_GOALS ? prev : [...prev, emptyRow()]));
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
    setErrors((prev) => {
      const next: Partial<Record<number, RowErrors>> = {};
      Object.entries(prev).forEach(([key, value]) => {
        const i = Number(key);
        if (i < index) next[i] = value;
        else if (i > index) next[i - 1] = value;
      });
      return next;
    });
  }

  function validate() {
    const next: Partial<Record<number, RowErrors>> = {};
    rows.forEach((row, index) => {
      const rowErrors: RowErrors = {};
      if (!row.description.trim()) {
        rowErrors.description = "Opis jest wymagany";
      }
      if (row.measureType === "numeric") {
        const value = Number(row.targetValue);
        if (!row.targetValue.trim() || !Number.isFinite(value) || value <= 0) {
          rowErrors.targetValue = "Podaj dodatnią wartość docelową";
        }
      }
      if (Object.keys(rowErrors).length > 0) {
        next[index] = rowErrors;
      }
    });
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    if (!validate()) {
      e.preventDefault();
    }
  }

  return (
    <form method="POST" action="/api/goals" className="space-y-6" onSubmit={handleSubmit} noValidate>
      <div className="space-y-4">
        {rows.map((row, index) => (
          <div key={index} className="space-y-3 rounded-lg border border-white/10 bg-white/5 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-blue-100/80">Cel {index + 1}</span>
              {rows.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    removeRow(index);
                  }}
                  className="text-red-300 hover:bg-red-500/10 hover:text-red-200"
                >
                  <Trash2 className="size-4" />
                  Usuń
                </Button>
              )}
            </div>

            <FormField
              id={`goals-${index}-description`}
              name={`goals.${index}.description`}
              label="Cel"
              value={row.description}
              onChange={(v) => {
                updateRow(index, { description: v });
              }}
              placeholder="np. Przeczytaj książki"
              error={errors[index]?.description}
              icon={<PenLine className="size-4" />}
            />

            <div>
              <Label className="mb-2 block text-sm text-blue-100/80">Miara</Label>
              <RadioGroup
                name={`goals.${index}.measureType`}
                value={row.measureType}
                onValueChange={(value) => {
                  updateRow(index, { measureType: value as MeasureType });
                }}
                className="flex flex-col gap-2"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="numeric" id={`goals-${index}-measure-numeric`} />
                  <Label htmlFor={`goals-${index}-measure-numeric`} className="font-normal text-white/80">
                    Wartość liczbowa
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="boolean" id={`goals-${index}-measure-boolean`} />
                  <Label htmlFor={`goals-${index}-measure-boolean`} className="font-normal text-white/80">
                    Tak / nie
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {row.measureType === "numeric" && (
              <FormField
                id={`goals-${index}-target`}
                name={`goals.${index}.targetValue`}
                type="number"
                label="Wartość docelowa"
                value={row.targetValue}
                onChange={(v) => {
                  updateRow(index, { targetValue: v });
                }}
                placeholder="np. 5"
                error={errors[index]?.targetValue}
                icon={<Target className="size-4" />}
              />
            )}
          </div>
        ))}
      </div>

      <Button
        type="button"
        variant="outline"
        onClick={addRow}
        disabled={rows.length >= MAX_GOALS}
        className="w-full border-white/20 bg-white/5 text-white hover:bg-white/10 disabled:opacity-50"
      >
        <Plus className="size-4" />
        Dodaj kolejny cel
      </Button>

      <ServerError message={serverError} />

      <SubmitButton pendingText="Zapisywanie..." icon={<Send className="size-4" />}>
        Zapisz cele
      </SubmitButton>
    </form>
  );
}
