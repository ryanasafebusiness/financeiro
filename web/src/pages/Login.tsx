import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Wallet, ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

type Step = "phone" | "code";

export default function Login() {
  const navigate = useNavigate();
  const { user, loginWithOtp } = useAuth();

  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState<string>("");
  const [code, setCode] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    if (user) {
      navigate("/dashboard");
    }
  }, [user, navigate]);

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const onlyDigits = phone.replace(/\D/g, "");
    if (onlyDigits.length < 10) {
      toast.error("Informe um telefone válido com DDD.");
      return;
    }
    setLoading(true);
    try {
      await api.requestOtp(onlyDigits);
      toast.success("Código enviado! Verifique seu WhatsApp.");
      setStep("code");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const onlyDigits = phone.replace(/\D/g, "");
    if (code.length !== 6) {
      toast.error("O código deve ter 6 dígitos.");
      return;
    }
    setLoading(true);
    try {
      const r = await api.verifyOtp(onlyDigits, code);
      const { error } = await loginWithOtp(r.email, r.token);
      if (error) {
        toast.error(error.message ?? "Não foi possível entrar. Tente novamente.");
        return;
      }
      navigate("/dashboard");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    const onlyDigits = phone.replace(/\D/g, "");
    setLoading(true);
    try {
      await api.requestOtp(onlyDigits);
      toast.success("Novo código enviado!");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    setStep("phone");
    setCode("");
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10">
      {/* Spotlight sutil ao fundo — profundidade sem ruído. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 [background:radial-gradient(60rem_40rem_at_50%_-10%,hsl(var(--primary)/0.10),transparent_70%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-border-strong to-transparent"
      />

      <div className="relative w-full max-w-[26rem] animate-fade-up">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-card bg-primary text-primary-foreground shadow-md">
            <Wallet className="h-6 w-6" />
          </div>
          <h1 className="text-[1.75rem] font-bold tracking-tight text-foreground">ZapWallet</h1>
          <p className="mt-1 text-body text-muted-foreground">Suas finanças, direto no WhatsApp.</p>
        </div>

        <Card className="shadow-md">
          <CardHeader>
            <CardTitle>{step === "phone" ? "Entrar" : "Confirme o código"}</CardTitle>
            <CardDescription>
              {step === "phone"
                ? "Informe seu telefone e enviaremos um código de acesso."
                : `Enviamos um código de 6 dígitos para o seu WhatsApp.`}
            </CardDescription>
          </CardHeader>

          <CardContent>
            {step === "phone" ? (
              <form onSubmit={handleRequestOtp} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="phone">Telefone</Label>
                  <Input
                    id="phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="(85) 99999-9999"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    disabled={loading}
                    autoFocus
                  />
                  <p className="text-label text-muted-foreground">
                    Inclua o DDD. Enviaremos um código pelo WhatsApp.
                  </p>
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                  Enviar código
                </Button>
              </form>
            ) : (
              <form onSubmit={handleVerifyOtp} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="code">Código de verificação</Label>
                  <Input
                    id="code"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    autoComplete="one-time-code"
                    placeholder="000000"
                    className="h-14 text-center text-2xl font-semibold tracking-[0.4em] tabular"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                    disabled={loading}
                    autoFocus
                  />
                </div>

                <Button type="submit" className="w-full" disabled={loading}>
                  {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                  Entrar
                </Button>

                <div className="flex items-center justify-between">
                  <Button type="button" variant="ghost" size="sm" onClick={handleBack} disabled={loading}>
                    <ArrowLeft className="h-4 w-4" />
                    Voltar
                  </Button>
                  <Button type="button" variant="link" size="sm" onClick={handleResend} disabled={loading}>
                    Reenviar código
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-label text-muted-foreground">
          Ao continuar, você concorda em receber mensagens do ZapWallet no WhatsApp.
        </p>
      </div>
    </div>
  );
}
