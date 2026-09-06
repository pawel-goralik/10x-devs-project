import React, { useState } from "react";
import { PenLine, TrendingUp, CircleCheck, Trash2, Send } from "lucide-react";
import { FormField } from "@/components/shared/FormField";
import { SubmitButton } from "@/components/shared/SubmitButton";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { Goal } from "@/types";

interface Props {
  goal: Goal;
  editable: boolean;
  remainingLabel: string | null;
}

function isReached(goal: Goal): boolean {
  return goal.measureType === "numeric" && goal.currentValue >= goal.targetValue;
}

/** shadcn's Dialog defaults to the light-theme `bg-background`/`text-foreground` tokens, which this app never
 * activates dark mode for (the dark look comes from explicit Tailwind classes) — override them here to match. */
const TRIGGER_BUTTON_CLASS = "flex-1 border border-white/20 bg-white/10 text-white hover:bg-white/20";
const DIALOG_CONTENT_CLASS = "border-white/10 bg-neutral-900 text-white";
const DIALOG_TITLE_CLASS = "text-white";
const DIALOG_DESCRIPTION_CLASS = "text-blue-100/60";

export default function GoalCard({ goal, editable, remainingLabel }: Props) {
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState(goal.description);
  const [targetValue, setTargetValue] = useState(goal.measureType === "numeric" ? String(goal.targetValue) : "");

  const celSection = editable ? (
    <FormField
      id={`edit-${goal.id}-description`}
      name={`edits.${goal.id}.description`}
      label="Cel"
      value={description}
      onChange={setDescription}
      icon={<PenLine className="size-4" />}
    />
  ) : (
    <div>
      <p className="mb-1 text-sm text-blue-100/80">Cel</p>
      <p className="font-medium text-white">{goal.description}</p>
    </div>
  );

  const progressSection = (
    <div>
      <p className="mb-1 text-sm text-blue-100/80">Postęp</p>
      {goal.measureType === "numeric" ? (
        <div className="flex items-center gap-2">
          <span className={isReached(goal) ? "text-sm font-medium text-emerald-300" : "text-sm text-white"}>
            {isReached(goal) && "✓ "}
            {goal.currentValue}
          </span>
          <span className="text-sm text-blue-100/40">/</span>
          {editable ? (
            <input
              id={`edit-${goal.id}-target`}
              name={`edits.${goal.id}.targetValue`}
              type="number"
              min="0"
              step="any"
              value={targetValue}
              onChange={(e) => {
                setTargetValue(e.target.value);
              }}
              className="w-20 rounded-lg border border-white/20 bg-white/10 px-2 py-1 text-sm text-white focus:ring-2 focus:ring-purple-400 focus:outline-none"
            />
          ) : (
            <span className="text-sm text-blue-100/60">{goal.targetValue}</span>
          )}
        </div>
      ) : (
        <p className={goal.isDone ? "text-sm font-medium text-emerald-300" : "text-sm text-blue-100/60"}>
          {goal.isDone ? "✓ Wykonano" : "Nieukończone"}
        </p>
      )}
    </div>
  );

  const progressTrigger =
    goal.measureType === "numeric" ? (
      <Dialog>
        <DialogTrigger asChild>
          <Button type="button" variant="secondary" className={TRIGGER_BUTTON_CLASS}>
            <TrendingUp className="size-4" />
            Dodaj postęp
          </Button>
        </DialogTrigger>
        <DialogContent className={DIALOG_CONTENT_CLASS}>
          <DialogHeader>
            <DialogTitle className={DIALOG_TITLE_CLASS}>Dodaj postęp</DialogTitle>
            <DialogDescription className={DIALOG_DESCRIPTION_CLASS}>{goal.description}</DialogDescription>
          </DialogHeader>
          <form method="POST" action="/api/goals/progress" className="space-y-4">
            <FormField
              id={`progress-${goal.id}-amount`}
              name={`progress.${goal.id}.amount`}
              type="number"
              label="Wartość do dodania"
              value={amount}
              onChange={setAmount}
              placeholder="np. 1"
              icon={<TrendingUp className="size-4" />}
            />
            <DialogFooter>
              <SubmitButton pendingText="Zapisywanie..." icon={<Send className="size-4" />}>
                Potwierdź
              </SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    ) : goal.isDone ? null : (
      <Dialog>
        <DialogTrigger asChild>
          <Button type="button" variant="secondary" className={TRIGGER_BUTTON_CLASS}>
            <CircleCheck className="size-4" />
            Oznacz jako wykonane
          </Button>
        </DialogTrigger>
        <DialogContent className={DIALOG_CONTENT_CLASS}>
          <DialogHeader>
            <DialogTitle className={DIALOG_TITLE_CLASS}>Oznacz jako wykonane</DialogTitle>
            <DialogDescription className={DIALOG_DESCRIPTION_CLASS}>{goal.description}</DialogDescription>
          </DialogHeader>
          <form method="POST" action="/api/goals/progress" className="space-y-4">
            <input type="hidden" name={`progress.${goal.id}.done`} value="on" />
            <DialogFooter>
              <SubmitButton pendingText="Zapisywanie..." icon={<Send className="size-4" />}>
                Potwierdź
              </SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    );

  if (!editable) {
    return (
      <div className="space-y-4 rounded-lg border border-white/10 bg-white/5 p-4">
        {celSection}
        {progressSection}
        {progressTrigger && <div className="flex border-t border-white/10 pt-4">{progressTrigger}</div>}
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-lg border border-white/10 bg-white/5 p-4">
      {remainingLabel && (
        <div className="flex justify-end">
          <span className="rounded-full border border-purple-400/30 bg-purple-500/10 px-3 py-1 text-xs font-medium text-purple-200">
            {remainingLabel}
          </span>
        </div>
      )}
      <form method="POST" action="/api/goals/manage" className="space-y-4">
        {celSection}
        {progressSection}
        <div className="flex flex-wrap items-center gap-3 border-t border-white/10 pt-4">
          {progressTrigger}
          <SubmitButton pendingText="Zapisywanie..." icon={<Send className="size-4" />} className="w-auto">
            Zapisz zmiany
          </SubmitButton>
          <Button
            type="submit"
            name="action"
            value={`delete:${goal.id}`}
            variant="ghost"
            className="border border-red-400/30 text-red-300 hover:bg-red-500/10 hover:text-red-200"
          >
            <Trash2 className="size-4" />
            Usuń
          </Button>
        </div>
      </form>
    </div>
  );
}
