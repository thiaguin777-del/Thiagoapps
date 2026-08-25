// ============================================================
// HOTSPOTS EM DOM, PROJETADOS DA CENA
// ------------------------------------------------------------
// Antes eram malha 3D: uma esfera de 10 cm mais um anel, dentro do
// scene graph. Três problemas medidos na versão anterior:
//
//  1. Custavam 20 draw calls e 20 materiais — para UI.
//  2. Ficavam sujeitos à profundidade da cena, então um marcador atrás de
//     uma parede sumia, e um marcador perto do sofá aparecia FLUTUANDO na
//     frente dele. Passei um bom tempo tratando "um anel laranja no meio
//     do encosto" como defeito de material antes de a sonda dizer que era
//     um objeto de 20 cm na frente.
//  3. Não dava para usar tipografia, backdrop-filter nem transição de CSS.
//
// Em DOM: zero draw call, zero material, e o anel pulsante e o tooltip com
// glassmorphism são três linhas de CSS. A profundidade continua sendo
// respeitada, mas por RAYCAST explícito — que é o teste correto ("existe
// parede entre a câmera e o ponto?") em vez de um efeito colateral do
// z-buffer.
// ============================================================
import * as THREE from 'three';

interface Ponto {
  pos: [number, number, number];
  title: string;
  desc: string;
}

interface CenaMinima {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  CONFIG: { hotspots: Ponto[] };
}

class Gerenciador {
  private camadaEl: HTMLDivElement | null = null;
  private itens: { p: Ponto; el: HTMLElement; v: THREE.Vector3 }[] = [];
  private cena: CenaMinima | null = null;
  private rc = new THREE.Raycaster();
  private ativo = false;
  private ultimoTeste = 0;
  public aoAbrir: ((titulo: string) => void) | null = null;

  async iniciar(): Promise<void> {
    const cena = (await import('../legado/cena-bruta')) as unknown as CenaMinima;
    // A cena pode ainda não ter subido; sem ela não há o que projetar.
    // O retorno silencioso daqui já custou uma sessão de depuração: os
    // marcadores simplesmente não existiam, sem erro nenhum no console.
    // Se desistir, DIGA por quê.
    if (!cena || !cena.scene || !cena.camera) {
      console.warn('[hotspots] cena indisponível — scene:', !!cena?.scene,
                   'camera:', !!cena?.camera, 'pontos:', cena?.CONFIG?.hotspots?.length);
      return;
    }
    this.cena = cena;

    this.camadaEl = document.createElement('div');
    this.camadaEl.id = 'camada-hotspots';
    this.camadaEl.style.cssText =
      'position:fixed;inset:0;pointer-events:none;z-index:40;overflow:hidden';
    document.body.appendChild(this.camadaEl);

    const pontos = cena.CONFIG?.hotspots || [];
    pontos.forEach((p) => this.criar(p));
    this.ativo = true;
    this.laco();
  }

  private criar(p: Ponto): void {
    const el = document.createElement('button');
    el.className = 'hotspot';
    el.type = 'button';
    el.innerHTML =
      `<span class="hs-anel"></span><span class="hs-nucleo"></span>` +
      `<span class="hs-balao"><strong>${p.title}</strong><em>${p.desc}</em></span>`;
    // `pointer-events` volta só no botão: a camada inteira continua
    // transparente ao clique, então arrastar a câmera por cima de um
    // hotspot continua arrastando a câmera.
    el.style.pointerEvents = 'auto';
    el.addEventListener('click', () => {
      el.classList.toggle('aberto');
      if (el.classList.contains('aberto') && this.aoAbrir) this.aoAbrir(p.title);
    });
    this.camadaEl!.appendChild(el);
    this.itens.push({ p, el, v: new THREE.Vector3(...p.pos) });
  }

  private laco = (): void => {
    if (!this.ativo || !this.cena) return;
    const { camera } = this.cena;
    const agora = performance.now();
    // O raycast de oclusão é caro para rodar a 60 Hz com N marcadores.
    // A 8 Hz o olho não percebe atraso num marcador aparecendo, e o custo
    // some. A PROJEÇÃO continua por quadro — é ela que precisa colar.
    const testarOclusao = agora - this.ultimoTeste > 125;
    if (testarOclusao) this.ultimoTeste = agora;

    const larg = window.innerWidth, alt = window.innerHeight;
    for (const it of this.itens) {
      const p = it.v.clone().project(camera);
      const atras = p.z > 1;
      const foraDoQuadro = p.x < -1.05 || p.x > 1.05 || p.y < -1.05 || p.y > 1.05;
      if (atras || foraDoQuadro) {
        it.el.style.display = 'none';
        continue;
      }
      if (testarOclusao) {
        const dir = it.v.clone().sub(camera.position);
        const dist = dir.length();
        this.rc.set(camera.position, dir.normalize());
        this.rc.far = dist - 0.25;   // margem: não colidir com o próprio alvo
        const bateu = this.rc.intersectObject(this.cena.scene, true)
          .some((h) => h.object.visible && (h.object as THREE.Mesh).isMesh);
        it.el.dataset.oculto = bateu ? '1' : '';
      }
      if (it.el.dataset.oculto === '1') {
        it.el.style.display = 'none';
        continue;
      }
      it.el.style.display = '';
      it.el.style.transform =
        `translate3d(${(p.x * 0.5 + 0.5) * larg}px, ${(-p.y * 0.5 + 0.5) * alt}px, 0) translate(-50%,-50%)`;
    }
    requestAnimationFrame(this.laco);
  };

  destruir(): void {
    this.ativo = false;
    this.itens.forEach((i) => i.el.remove());
    this.itens = [];
    this.camadaEl?.remove();
    this.camadaEl = null;
  }
}

export const HotspotManager = new Gerenciador();
