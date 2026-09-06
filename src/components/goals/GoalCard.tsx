import React, { useState } from "react";
import { PenLine, Target, TrendingUp, Trash2, Send } from "lucide-react";
import { FormField } from "@/components/shared/FormField";
import { SubmitButton } from "@/components/shared/SubmitButton";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { Goal } from "@/types";

interface Props {
  goal: Goal;
  editable: boolean;
  remainingLabel: string | null;
}

function measureLabel(goal: Goal): string {
  return goal.measureType === "numeric" ? `Cel: ${goal.targetValue}` : "Tak / nie";
}

function isReached(goal: Goal): boolean {
  return goal.measureType === "numeric" && goal.currentValue >= goal.targetValue;
}

export default function GoalCard({ goal, editable, remainingLabel }: Props) {
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState(goal.description);
  const [targetValue, setTargetValue] = useState(goal.measureType === "numeric" ? String(goal.targetValue) : "");

  return (
    <div className="space-y-4 rounded-lg border border-white/10 bg-white/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium text-white">{goal.description}</p>
          <p className="text-sm text-blue-100/60">{measureLabel(goal)}</p>
        </div>
        {editable && remainingLabel && (
          <span className="rounded-full border border-purple-400/30 bg-purple-500/10 px-3 py-1 text-xs font-medium text-purple-200">
            {remainingLabel}
          </span>
        )}
      </div>

      {goal.measureType === "numeric" ? (
        <form method="POST" action="/api/goals/progress" className="flex flex-wrap items-end gap-3">
          <span className={isReached(goal) ? "text-sm font-medium text-emerald-300" : "text-sm text-blue-100/60"}>
            {isReached(goal) && "✓ "}
            {goal.currentValue} / {goal.targetValue}
          </span>
          <div className="min-w-40 flex-1">
            <FormField
              id={`progress-${goal.id}-amount`}
              name={`progress.${goal.id}.amount`}
              type="number"
              label="Dodaj postęp"
              value={amount}
              onChange={setAmount}
              placeholder="np. 1"
              icon={<TrendingUp className="size-4" />}
            />
          </div>
          <SubmitButton pendingText="Zapisywanie..." icon={<Send className="size-4" />}>
            Zapisz postęp
          </SubmitButton>
        </form>
      ) : goal.isDone ? (
        <p className="text-sm font-medium text-emerald-300">✓ Wykonano</p>
      ) : (
        <form method="POST" action="/api/goals/progress" className="flex flex-wrap items-center gap-3">
          <Label className="text-sm font-normal text-blue-100/80">
            <input
              type="checkbox"
              name={`progress.${goal.id}.done`}
              className="h-4 w-4 rounded border-white/20 bg-white/10 text-purple-500 focus:ring-2 focus:ring-purple-400"
            />
            Oznacz jako wykonane
          </Label>
          <SubmitButton pendingText="Zapisywanie..." icon={<Send className="size-4" />}>
            Zapisz postęp
          </SubmitButton>
        </form>
      )}

      {editable && (
        <form method="POST" action="/api/goals/manage" className="space-y-3 border-t border-white/10 pt-4">
          <FormField
            id={`edit-${goal.id}-description`}
            name={`edits.${goal.id}.description`}
            label="Cel"
            value={description}
            onChange={setDescription}
            icon={<PenLine className="size-4" />}
          />
          {goal.measureType === "numeric" && (
            <FormField
              id={`edit-${goal.id}-target`}
              name={`edits.${goal.id}.targetValue`}
              type="number"
              label="Wartość docelowa"
              value={targetValue}
              onChange={setTargetValue}
              icon={<Target className="size-4" />}
            />
          )}
          <div className="flex items-center justify-between gap-3">
            <SubmitButton pendingText="Zapisywanie..." icon={<Send className="size-4" />}>
              Zapisz zmiany
            </SubmitButton>
            <Button
              type="submit"
              name="action"
              value={`delete:${goal.id}`}
              variant="ghost"
              size="sm"
              className="text-red-300 hover:bg-red-500/10 hover:text-red-200"
            >
              <Trash2 className="size-4" />
              Usuń
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
