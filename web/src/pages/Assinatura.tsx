import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, XCircle, Crown, Sparkles, MessageCircle, Clock, Zap } from "lucide-react";

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useProfile, isPremiumActive } from "@/hooks/useProfile";
import { api } from "@/lib/api";
import { cn, brl, formatDate } from "@/lib/utils";

interface PlanItem {
  id: string;
  name: string;
  price: number;
  duration_days: number;
  message_limit: number;
}

interface PlansResponse {
  plans: PlanItem[];
  checkout_url: string;
}

function daysLeft(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.floor(diff / 86_400_000));
}

export default function Assinatura() {
  const { data: profile, isLoading: profileLoading } = useProfile();

  const { data: plansData, isLoading: plansLoading } = useQuery<PlansResponse>({
    queryKey: ["plans"],
    queryFn: async () => {
      const res = await api.plans();
      return res as PlansResponse;
    },
  });

  const active = isPremiumActive(profile ?? null);
  const planName = profile?.plan || "Trial";
  const checkoutUrl = plansData?.checkout_url ?? "";
  const isTrial = planName === "Trial";

  const msgsUsed = profile?.messages_this_month ?? 0;
  const msgsLimit = profile?.message_limit ?? 0;
  const msgsRemaining = msgsLimit > 0 ? Math.max(0, msgsLimit - msgsUsed) : null;
  const msgsPct = msgsLimit > 0 ? (msgsUsed / msgsLimit) * 100 : 0;
  const days = daysLeft(profile?.premium_until);

  const urgentQuota = msgsRemaining !== null && msgsRemaining <= 3;
  const urgentDays = days !== null && days <= 1;
  const isUrgent = isTrial && active && (urgentQuota || urgentDays);

  const handleSubscribe = () => {
    if (checkoutUrl) window.open(checkoutUrl, "_blank");
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Assinatura</h1>
        <p className="text-muted-foreground">
          Acompanhe o status do seu plano e escolha a melhor opção para você.
        </p>
      </div>

      {/* Status do plano atual */}
      {profileLoading ? (
        <Skeleton className="h-40 w-full mb-8 rounded-lg" />
      ) : (
        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="rounded-full bg-primary/10 p-2 text-primary">
                  <Crown className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle>Plano atual</CardTitle>
                  <CardDescription>{planName}</CardDescription>
                </div>
              </div>
              {active ? (
                <Badge variant="success" className="gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Ativo
                </Badge>
              ) : (
                <Badge variant="destructive" className="gap-1">
                  <XCircle className="h-3.5 w-3.5" />
                  Inativo/Expirado
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {profile?.premium_until && (
              <p className="text-sm">
                <span className="text-muted-foreground">Validade: </span>
                <span className="font-medium">{formatDate(profile.premium_until)}</span>
              </p>
            )}
            {!isTrial && (
              <p className="text-sm text-muted-foreground">
                O acesso é liberado automaticamente assim que o pagamento é confirmado.
                Depois disso, é só mandar uma mensagem no WhatsApp para começar a usar o ZapWallet.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Seção de trial — uso atual e urgência */}
      {isTrial && active && !profileLoading && (
        <Card
          className={cn(
            "mb-8",
            isUrgent
              ? "border-amber-300 bg-amber-50"
              : "border-primary/20 bg-primary/5"
          )}
        >
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className={cn("h-4 w-4", isUrgent ? "text-amber-600" : "text-primary")} />
              Período de teste grátis
            </CardTitle>
            {isUrgent && (
              <CardDescription className="text-amber-700 font-medium">
                {urgentQuota && msgsRemaining === 0
                  ? "Você usou todas as mensagens do trial. Assine para continuar!"
                  : urgentQuota
                  ? `Restam só ${msgsRemaining} mensagem${msgsRemaining === 1 ? "" : "s"} no trial.`
                  : days === 0
                  ? "Seu trial expira hoje!"
                  : "Seu trial termina amanhã."}
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {msgsLimit > 0 && (
              <div>
                <div className="mb-1.5 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Mensagens usadas</span>
                  <span className="font-medium">
                    {msgsUsed} / {msgsLimit}
                    {msgsRemaining !== null && (
                      <span className="ml-1 text-muted-foreground">
                        ({msgsRemaining} restante{msgsRemaining === 1 ? "" : "s"})
                      </span>
                    )}
                  </span>
                </div>
                <Progress value={msgsPct} />
              </div>
            )}
            {days !== null && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Expira em</span>
                <span className="font-medium">
                  {days === 0 ? "Hoje" : `${days} dia${days === 1 ? "" : "s"}`}
                </span>
              </div>
            )}
            {isUrgent && checkoutUrl && (
              <Button
                className="w-full"
                onClick={handleSubscribe}
              >
                <Zap className="mr-2 h-4 w-4" />
                Assinar agora e continuar sem parar
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Planos disponíveis */}
      <div className="mb-4">
        <h2 className="text-lg font-semibold">Planos disponíveis</h2>
        <p className="text-sm text-muted-foreground">
          Escolha o plano ideal e libere o acesso na hora.
        </p>
      </div>

      {plansLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-72 w-full rounded-lg" />
          <Skeleton className="h-72 w-full rounded-lg" />
          <Skeleton className="h-72 w-full rounded-lg" />
        </div>
      ) : !plansData || plansData.plans.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Nenhum plano disponível no momento.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {plansData.plans.map((plan, index) => {
            const isHighlighted =
              index === Math.floor(plansData.plans.length / 2) &&
              plansData.plans.length > 1;
            return (
              <Card
                key={plan.id}
                className={cn(
                  "flex flex-col",
                  isHighlighted &&
                    "border-primary shadow-lg ring-1 ring-primary/40 relative"
                )}
              >
                {isHighlighted && (
                  <Badge
                    variant="success"
                    className="absolute -top-3 left-1/2 -translate-x-1/2 gap-1"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Mais popular
                  </Badge>
                )}
                <CardHeader>
                  <CardTitle>{plan.name}</CardTitle>
                  <CardDescription>{plan.duration_days} dias</CardDescription>
                </CardHeader>
                <CardContent className="flex-1 space-y-2">
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-bold text-primary">
                      {brl(Number(plan.price))}
                    </span>
                  </div>
                  <ul className="space-y-1.5 text-sm text-muted-foreground">
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      {plan.duration_days} dias de acesso
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      {plan.message_limit > 0
                        ? `${plan.message_limit} mensagens`
                        : "Mensagens ilimitadas"}
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      Liberação automática após o pagamento
                    </li>
                  </ul>
                </CardContent>
                <CardFooter>
                  <Button
                    className="w-full"
                    variant={isHighlighted ? "default" : "outline"}
                    onClick={handleSubscribe}
                    disabled={!checkoutUrl}
                  >
                    Assinar
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}

      {/* Aviso amigável */}
      <Card className="mt-8 border-primary/30 bg-primary/5">
        <CardContent className="flex items-start gap-3 py-5">
          <div className="rounded-full bg-primary/10 p-2 text-primary">
            <MessageCircle className="h-5 w-5" />
          </div>
          <p className="text-sm text-foreground">
            Após pagar pela Cakto, seu acesso é liberado na hora. Volte ao
            WhatsApp e mande um oi para o ZapWallet 💚
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
