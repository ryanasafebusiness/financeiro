import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  CheckCircle2, XCircle, Crown, Sparkles, MessageCircle, Clock, Zap, Loader2,
} from "lucide-react";

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
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { useProfile, isPremiumActive } from "@/hooks/useProfile";
import { api } from "@/lib/api";
import { cn, money, formatDate } from "@/lib/utils";

interface PlanItem {
  id: string;
  name: string;
  price: number;
  duration_days: number;
  message_limit: number;
}

interface PlansResponse {
  plans: PlanItem[];
}

function daysLeft(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.floor(diff / 86_400_000));
}

export default function Assinatura() {
  const { data: profile, isLoading: profileLoading } = useProfile();
  const [searchParams, setSearchParams] = useSearchParams();
  const [checkoutPlanId, setCheckoutPlanId] = useState<string | null>(null);

  // Retorno do checkout da Stripe. O acesso em si é liberado pelo webhook, que
  // pode chegar alguns segundos depois — por isso a mensagem não promete nada.
  useEffect(() => {
    const status = searchParams.get("checkout");
    if (!status) return;
    if (status === "sucesso") {
      toast.success("Pagamento recebido! Seu acesso é liberado em instantes 💚");
    } else if (status === "cancelado") {
      toast.info("Checkout cancelado — nada foi cobrado.");
    }
    const next = new URLSearchParams(searchParams);
    next.delete("checkout");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const { data: plansData, isLoading: plansLoading } = useQuery<PlansResponse>({
    queryKey: ["plans"],
    queryFn: async () => {
      const res = await api.plans();
      return res as PlansResponse;
    },
  });

  const active = isPremiumActive(profile ?? null);
  const planName = profile?.plan || "Trial";
  const isTrial = planName === "Trial";

  const msgsUsed = profile?.messages_this_month ?? 0;
  const msgsLimit = profile?.message_limit ?? 0;
  const msgsRemaining = msgsLimit > 0 ? Math.max(0, msgsLimit - msgsUsed) : null;
  const msgsPct = msgsLimit > 0 ? (msgsUsed / msgsLimit) * 100 : 0;
  const days = daysLeft(profile?.premium_until);

  const urgentQuota = msgsRemaining !== null && msgsRemaining <= 3;
  const urgentDays = days !== null && days <= 1;
  const isUrgent = isTrial && active && (urgentQuota || urgentDays);

  /** Abre a Checkout Session da Stripe para o plano escolhido. */
  const handleSubscribe = async (planId?: string) => {
    const id = planId ?? plansData?.plans[0]?.id;
    if (!id) {
      toast.error("Nenhum plano disponível no momento.");
      return;
    }
    setCheckoutPlanId(id);
    try {
      const { url } = await api.createCheckout(id);
      // Mesma aba: o retorno da Stripe traz o usuário de volta a /assinatura.
      window.location.assign(url);
    } catch (err) {
      toast.error((err as Error).message || "Não foi possível abrir o checkout.");
      setCheckoutPlanId(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Assinatura"
        description="Acompanhe o status do seu plano e escolha a melhor opção para você."
      />

      {/* Status do plano atual */}
      {profileLoading ? (
        <Skeleton className="h-40 w-full mb-8 rounded-lg" />
      ) : (
        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-soft text-primary">
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
              ? "border-warning/30 bg-warning/[0.08]"
              : "border-primary/20 bg-primary/5"
          )}
        >
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className={cn("h-4 w-4", isUrgent ? "text-warning" : "text-primary")} />
              Período de teste grátis
            </CardTitle>
            {isUrgent && (
              <CardDescription className="text-warning font-medium">
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
            {isUrgent && (plansData?.plans.length ?? 0) > 0 && (
              <Button
                className="w-full"
                onClick={() => handleSubscribe()}
                disabled={checkoutPlanId !== null}
              >
                {checkoutPlanId ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Zap className="h-4 w-4" />
                )}
                Assinar agora e continuar sem parar
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Planos disponíveis */}
      <div className="mb-4 mt-8">
        <h2 className="text-card-title font-semibold text-foreground">Planos disponíveis</h2>
        <p className="text-meta text-muted-foreground">
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
          <EmptyState
            icon={<Crown />}
            title="Nenhum plano disponível"
            description="Nenhum plano está publicado no momento. Tente novamente mais tarde."
          />
        </Card>
      ) : (
        <div className="grid gap-4 pt-3 sm:grid-cols-2 xl:grid-cols-3 stagger">
          {plansData.plans.map((plan, index) => {
            const isHighlighted =
              index === Math.floor(plansData.plans.length / 2) &&
              plansData.plans.length > 1;
            return (
              <Card
                key={plan.id}
                className={cn(
                  "relative flex flex-col surface-interactive",
                  isHighlighted && "border-primary/40 shadow-md ring-1 ring-primary/20"
                )}
              >
                {isHighlighted && (
                  <Badge
                    variant="solid"
                    className="absolute -top-2.5 left-1/2 z-10 -translate-x-1/2 gap-1 shadow-xs"
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
                    <span className="text-metric font-semibold tabular text-foreground">
                      {money(Number(plan.price))}
                    </span>
                  </div>
                  <ul className="space-y-2 pt-1 text-meta text-muted-foreground">
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                      {plan.duration_days} dias de acesso
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                      {plan.message_limit > 0
                        ? `${plan.message_limit} mensagens`
                        : "Mensagens ilimitadas"}
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                      Liberação automática após o pagamento
                    </li>
                  </ul>
                </CardContent>
                <CardFooter>
                  <Button
                    className="w-full"
                    variant={isHighlighted ? "default" : "outline"}
                    onClick={() => handleSubscribe(plan.id)}
                    disabled={checkoutPlanId !== null}
                  >
                    {checkoutPlanId === plan.id && (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    )}
                    Assinar
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}

      {/* Aviso amigável */}
      <Card className="mt-6 border-primary/20 bg-primary-soft/60">
        <CardContent className="flex items-start gap-3 pt-6">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-card text-primary shadow-xs">
            <MessageCircle className="h-[1.05rem] w-[1.05rem]" />
          </div>
          <p className="text-meta leading-relaxed text-foreground">
            O pagamento é processado pela Stripe e seu acesso é liberado
            automaticamente. Depois é só voltar ao WhatsApp e mandar um oi para o
            ZapWallet 💚
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
