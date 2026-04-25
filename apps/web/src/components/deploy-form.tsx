import { FormEvent, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { GitBranch, PackageOpen, Rocket } from "lucide-react";
import { toast } from "sonner";
import { createDeployment, deploymentsQueryKey, type Deployment, type SourceType } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface DeployFormProps {
  onCreated: (deployment: Deployment) => void;
}

export const DeployForm = ({ onCreated }: DeployFormProps) => {
  const [sourceType, setSourceType] = useState<SourceType>("git");
  const [port, setPort] = useState("3000");
  const formRef = useRef<HTMLFormElement>(null);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: createDeployment,
    onSuccess: (deployment) => {
      queryClient.invalidateQueries({ queryKey: deploymentsQueryKey });
      toast.success("Deployment queued");
      formRef.current?.reset();
      setPort("3000");
      onCreated(deployment);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Deployment failed to queue");
    }
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.set("sourceType", sourceType);
    formData.set("containerPort", port);
    mutation.mutate(formData);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>New Deployment</CardTitle>
      </CardHeader>
      <CardContent>
        <form ref={formRef} onSubmit={submit} className="space-y-4">
          <Tabs value={sourceType} onValueChange={(value) => setSourceType(value as SourceType)}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="git">
                <GitBranch className="h-4 w-4" />
                Git
              </TabsTrigger>
              <TabsTrigger value="archive">
                <PackageOpen className="h-4 w-4" />
                Upload
              </TabsTrigger>
            </TabsList>

            <TabsContent value="git" className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="gitUrl">Git URL</Label>
                <Input id="gitUrl" name="gitUrl" placeholder="https://github.com/acme/app.git" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="gitRef">Git ref</Label>
                <Input id="gitRef" name="gitRef" placeholder="main" />
              </div>
            </TabsContent>

            <TabsContent value="archive" className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="archive">Project archive</Label>
                <Input id="archive" name="archive" type="file" accept=".zip,.tgz,.tar.gz,application/zip" />
              </div>
            </TabsContent>
          </Tabs>

          <div className="space-y-2">
            <Label htmlFor="containerPort">Container port</Label>
            <Input
              id="containerPort"
              inputMode="numeric"
              value={port}
              onChange={(event) => setPort(event.target.value)}
            />
          </div>

          <Button type="submit" className="w-full" disabled={mutation.isPending}>
            <Rocket className="h-4 w-4" />
            {mutation.isPending ? "Queuing..." : "Deploy"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
};
