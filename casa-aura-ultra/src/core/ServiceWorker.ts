// ============================================================
// SERVICE WORKER — cache dos ativos pesados
// ------------------------------------------------------------
// O que ele resolve, em termos de negócio: o corretor abre a mesma
// experiência dezenas de vezes por semana, muitas em rede de operadora
// dentro de um stand de vendas. O segundo acesso não pode baixar 1 MB de
// motor 3D de novo.
//
// O que ele NÃO faz: cache da página. A casa muda; o motor não. Cachear o
// index.html criaria a pior falha possível — o cliente vendo uma versão
// antiga do imóvel sem saber.
// ============================================================

export function registrarServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  // Em desenvolvimento o SW só atrapalha: ele serviria assets em cache
  // enquanto o Vite tenta fazer hot reload.
  if (import.meta.env.DEV) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e) => {
      // Falhar aqui é inofensivo: sem SW a experiência funciona igual,
      // só sem cache. Nunca deixar isso escalar para o usuário.
      console.info('[sw] não registrado:', e && e.message);
    });
  });
}

/** Limpa o cache e recarrega. Alimenta o botão "Reiniciar Experiência". */
export async function reiniciarExperiencia(): Promise<void> {
  try {
    if ('caches' in window) {
      const chaves = await caches.keys();
      await Promise.all(chaves.map((k) => caches.delete(k)));
    }
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch (e) {
    console.info('[sw] limpeza parcial:', e);
  }
  // `location.reload()` sem argumento já ignora o cache de memória depois
  // de o Cache Storage ter sido esvaziado acima.
  location.reload();
}
