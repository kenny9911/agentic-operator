"use client";

import { useState } from "react";
import { Button } from "@/components";
import { DeployAgentModal } from "./DeployAgentModal";

export function AgentsHeaderActions() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button icon="upload" small>
        Import manifest
      </Button>
      <Button
        icon="plus"
        tone="primary"
        small
        onClick={() => setOpen(true)}
      >
        Deploy agent
      </Button>
      {open && <DeployAgentModal onClose={() => setOpen(false)} />}
    </>
  );
}
