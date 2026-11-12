# Track Day

Tablero de pista para el iDrive 7 (MGU), pensado para el **M240i xDrive G42 (B58 + ZF 8HP, turbo Hypercore, flex fuel)**. Todo en una sola vista, solo números. Por defecto: temperaturas en °C, presiones en psi y mezcla en AFR (las unidades se cambian en Ajustes).

```
┌─ LLANTAS ──────────┬─ OIL TEMP ─┬─ OIL PRESS ┬─ COOLANT ──┬─ GEARBOX ──┐
│ FL 35.5   FR 35.2  │  112 °C    │  70 psi    │  98 °C     │  95 °C     │
│  +5.1      +4.8    │  peak 118  │  min 57    │  peak 104  │  peak 101  │
│  54 °C     51 °C   ├─ INTAKE ───┼─ CHARGE AIR┼─ FUEL TEMP ┼─ ETHANOL ──┤
│                    │  34 °C     │  41 °C     │  38 °C     │  42 %      │
│ RL 36.5   RR 36.3  ├─ BOOST ────┼─ HPFP ─────┼─ AFR ──────┼─ KNOCK ────┤
│  +5.8      +5.5    │ 23.5 psi   │ 4950 psi   │  12.1      │  -1.5°     │
│  58 °C     56 °C   │ target 24.7│ target 5075│ target 11.8│ worst -3.0°│
└────────────────────┴────────────┴────────────┴────────────┴────────────┘
```

## Qué significa cada dato

| Recuadro | Qué es | Debajo muestra |
| --- | --- | --- |
| Llantas | Por llanta: presión (grande) y temperatura del aire interno. El objetivo en caliente de cada eje va una vez, arriba a la derecha del panel ("target 35.0 / 35.0") | "inflate cold": a cuánto calibrar en frío para la próxima tanda |
| Oil temp | Temperatura de aceite del motor | Pico de la sesión |
| Oil pressure | Presión de aceite sobre la atmosférica | **Mínimo** de la sesión por encima de 2000 rpm |
| Coolant | Refrigerante del motor | Pico |
| Gearbox | Aceite de la ZF 8HP | Pico |
| Intake air | Aire que entra al filtro, antes del turbo | Pico |
| Charge air | Aire **después del intercooler**, el que entra a los cilindros. Si sube, el intercooler está saturado y la DME quita avance | Pico |
| Fuel temp | Temperatura del combustible | Pico |
| Ethanol | % de etanol que usa el mapa de MHD (**Active**) | Lo que mide el sensor ("MHD, sensor 42"), o de dónde sale si no es MHD |
| Boost | Presión del turbo real | Objetivo del mapa |
| HPFP | Presión de la bomba de alta real | Objetivo |
| AFR | Relación aire-combustible real (14.7 = estequiométrica, menos = rica). Se calcula de la lambda de la DME | Objetivo |
| Knock | Retardo promedio de encendido por knock (0 = nada) | El peor de la sesión |

## Unidades (Ajustes)

| Ajuste | Opciones |
| --- | --- |
| Temperature unit | °C (por defecto) o °F |
| Pressure unit (tyres, oil, boost) | psi (por defecto), bar o kPa |
| Fuel pressure unit (HPFP) | psi (por defecto), bar o MPa |
| Mixture shown as | **AFR escala gasolina** (lambda × 14.7, como lo muestran MHD/BM3; por defecto), **AFR del combustible** (usa el % de etanol: 14.7 con gasolina hasta 9.0 con etanol puro; aproximado) o **Lambda** |

Todo el tablero cambia: números, objetivos, picos, mínimos y el "inflate cold" de las llantas. Los **umbrales** de Ajustes (alertas y objetivos de llantas) siguen en °C y psi, porque el menú de Ajustes del iDrive no puede cambiar sus propias unidades.

## Colores

Una sola escala para todo el tablero:

| Color | Significa |
| --- | --- |
| Verde | Normal: la app lo revisó y está en su rango o en el objetivo |
| Azul | Frío, todavía no está en temperatura de trabajo |
| Amarillo | Atención, cerca del límite |
| Rojo | Peligro, pasado del límite (también sale la alerta arriba) |
| Blanco | Sin evaluar: no hay rango para ese dato (etanol), o no aplica en ese momento (boost sin carga, sin objetivo) |

Cuando un dato pasa a **rojo**, todo su recuadro se tiñe de rojo (además de la alerta arriba), para verlo de reojo.

Cada recuadro lleva un **icono** al estilo de los testigos de BMW (aceitera, termómetro, engranaje, turbo, bomba de combustible, gota con "E", rayo para el knock), dibujado con las formas del kit en `icons.js` (el kit no carga imágenes). El carro del panel de llantas es una silueta del G42 vista desde arriba, con las llantas (textura de banda) dentro de la carrocería; al lado de cada llanta, solo su presión, su temperatura y "inflate cold".

Los recuadros no llevan las franjas M: van una sola vez, a la izquierda del título **"Track Day Mode"**, más grande y en negrita. Ese título lo dibuja el kit en la franja del iDrive; para eso el kit tiene una opción nueva, `config.header` en `app.json` (`size`, `bold`, `stripes`), en `kit/runtime/gauges.js` (headerCompact) y `kit/runtime/display.js`. Solo la usa esta app: las demás apps del repo se ven igual.

### Llantas: qué decide el color

Dos escalas independientes.

**La llanta del dibujo y el número de temperatura: la temperatura**

| Color | Cuándo (valores por defecto, ajustables) |
| --- | --- |
| Azul | Fría: bajo 35 °C |
| Verde | Temperatura de trabajo: 35 – 79 °C |
| Amarillo | Algo por encima: 80 – 94 °C |
| Rojo | Muy por encima: 95 °C o más (TYRE HOT) |
| Gris | El carro no envía temperatura |


**El número de presión: la presión contra tu objetivo en caliente**

| Color | Cuándo |
| --- | --- |
| Rojo | Desinflada: más de 3 psi por debajo del objetivo, o fuga (menos de 20 psi, o 3 psi menos que en frío) |
| Amarillo | Algo por debajo: −1.5 a −3 psi |
| Verde | En el objetivo: ±1.5 psi |
| Amarillo | Por encima: +1.5 a +3 psi |
| Rojo | Muy por encima: más de +3 psi |
| Azul | Llanta fría: todavía no se compara contra el objetivo en caliente (una llanta fría siempre está por debajo) |

### Presión en frío para la siguiente tanda

Debajo de cada llanta, ya caliente, aparece **"inflate cold: 27.0"**: la presión a la que debes calibrar en frío para llegar a tu objetivo en caliente. Se calcula como presión en frío de esta sesión + (objetivo − presión en caliente ahora), redondeado a 0.5 psi.

Ejemplo: calibras a 29 en frío, tu objetivo es 35 y llegas a 37 → inflate cold: **27.0**.

Flujo recomendado:
1. Configura el objetivo **en caliente** del perfil (por ejemplo 35 psi).
2. Calibra en frío y presiona **New session**: esa primera lectura queda como la presión en frío.
3. Sal a pista. Al volver, usa "inflate cold" para calibrar en frío la siguiente tanda y presiona New session de nuevo.

Si sacas aire en caliente en pits, la referencia en frío deja de cuadrar: es mejor ajustar en frío entre tandas.

Boost (solo bajo carga, objetivo > 6 psi): amarillo si está 2 psi o más por debajo del objetivo, rojo si está 4 psi o más por debajo, o 3 psi o más por encima (sobrepresión).

## Alertas (arriba)

OIL PRESS LOW · LEAN · HPFP LOW · KNOCK · OIL HOT · COOLANT HOT · GEARBOX HOT · CHARGE AIR HOT · TYRE HOT · TYRE LOW · E MISMATCH (amarilla)

- **E MISMATCH**: el etanol del mapa (Active) y el del sensor están a 10 puntos o más. Pasa después de tanquear, mientras el mapa termina de mezclar, o con un mapa que no sigue al sensor. El número de etanol se pone amarillo.

- **LEAN**: a carga (objetivo de lambda < 0.95) la mezcla real está 0.05 o más pobre que el objetivo.
- **HPFP LOW**: la presión real está más de 15 % por debajo del objetivo (con objetivo > 100 bar).
- **OIL PRESS LOW**: por debajo del límite configurado, solo por encima de 2000 rpm.

## Perfiles de llantas

Tres perfiles: **Dry**, **Hot track** y **Wet**. Cada uno con su objetivo de presión **en caliente** adelante y atrás, de 28 a 44 psi en pasos de 0.5.

- En Ajustes eliges el **perfil activo** y solo ves los dos objetivos de ese perfil. Para configurar otro, cámbiate a él.
- El perfil activo aparece en el título del recuadro: "Tyres - Dry".
- Color de la presión: verde a ±1.5 psi del objetivo, amarillo a ±3 psi, rojo más lejos.
- Si el perfil no tiene objetivo, la llanta dice **"set hot target"** en amarillo y la presión queda sin color.
- La presión de la etiqueta de la puerta (la del TPMS) **no se usa**: es una presión en frío para calle, muy por encima de una calibración de pista (29 psi). TYRE LOW sale si una llanta baja de 20 psi, pierde 3 psi o más frente a su lectura en frío de la sesión (fuga), o ya caliente queda por debajo del 85 % de tu objetivo.

Ejemplo: en caliente quieres 36 psi, calibraste en frío a 30 y la llanta llegó a 37: la app muestra "inflate cold: 29.0".

## Otros ajustes

Origen del etanol (abajo), ventana de temperatura de llantas y umbrales de aceite, presión de aceite, refrigerante, caja, charge air y knock.

## Etanol (MHD flex fuel)

El sensor de flex fuel mide el etanol del combustible. MHD lo recibe y guarda dos números en la memoria de la DME: **CAN** (lo que mide el sensor) y **Active** (lo que usa el mapa). La app lee esos dos números de la misma forma que lo hace la app **Flex Fuel de Perea Performance**, de la que vienen `mhd_poller.js` y `mhd_protocol.js` (licencia MIT, ver `NOTICE`):

1. Confirma que la DME tiene MHD (`2F 04 "MHD"`).
2. Lee la versión de software de la DME (`22 F1 01/02`) y busca sus direcciones en los perfiles conocidos.
3. Le pide a la DME armar un identificador temporal (`2C`, F303 o F301) con las dos direcciones de MHD.
4. Lo lee dos veces por segundo (`22 F3 03`).

El paso 3 es la única petición que no es una lectura: arma una tabla **temporal** que la DME olvida al apagar el carro. No toca el mapa ni la memoria permanente. Por eso esas peticiones van por un enlace de diagnóstico completo (el mismo que usan M Vitals y Perea), y todas las demás siguen por el enlace de solo lectura. Las dos comparten una sola fila: nunca va más de una petición a la vez.

**Ajuste "Ethanol from":**

| Opción | Qué muestra |
| --- | --- |
| Auto (por defecto) | MHD si responde; si no, el valor propio de la DME (`550D`) con el motivo debajo ("DME: no MHD", "DME: ROM unmapped") |
| MHD flex fuel | Solo MHD; `--` si no responde |
| DME's own value | Solo el `550D`; no le pregunta nada a MHD |

El `550D` es lo que la DME de fábrica cree que tiene el combustible; con el flex fuel de MHD puede no coincidir con lo que usa el mapa.

**Mientras logueas con la app de MHD**, cierra este tablero o cambia de pantalla: las dos usan los mismos identificadores temporales de la DME y se los quitarían una a la otra. Con el tablero oculto, la app no le pregunta nada a la DME.

## De dónde salen los datos

- **Señales del coche**: llantas (TPMS), temperatura de aceite y refrigerante, rpm.
- **DME (B58) y unidad de la caja (ZF 8HP)**, por diagnóstico con un enlace de **solo lectura**: la app no puede escribir, borrar ni cambiar nada. Solo pregunta mientras la pantalla está abierta. Lo rápido (presión de aceite, boost, HPFP, lambda, knock) unas 2–3 veces por segundo; lo lento (combustible, caja, `550D`) cada pocos segundos.
- **Etanol de MHD**: ver la sección anterior.
- Los identificadores y escalas están en `app.json` → `config.dme`, tomados del catálogo del B58 que trae el kit; los del etanol de MHD en `mhd_protocol.js`.

## Por verificar en el carro (primera salida)

1. **Versión de software de la DME (PRGID) para el etanol de MHD.** Las direcciones están mapeadas para la familia **5D55** (B58 gen2, MG1). El PRGID aparece al inicio de cualquier log exportado de MHD (`#Ecu PRGID`). Si el recuadro dice "DME: ROM unmapped", hay que capturar el tráfico de la app de MHD con PCAPdroid y agregar el perfil en `mhd_protocol.js`, como explica el README de la app Flex Fuel de Perea ("Your ROM").
2. **HPFP**: uso primero el identificador "nuevo" (5658), porque el viejo (58EF) se queda en 327 bar y tu motor puede pasar de 350. Comparar con MHD.
3. **Knock**: el signo y la escala del retardo (554C). Los primeros valores crudos quedan en el log (`raw knock`).
4. **Temperatura de caja**: el identificador de la ZF 8HP está confirmado en un G22; en el G42 debería ser igual.
5. La temperatura de llanta es del **aire interno** (TPMS), no de la banda: más baja y lenta que un pirómetro.

Si un valor no responde, el recuadro muestra `--` y el resto sigue funcionando.

## Instalar con el MGU Store

La app vive en un fork de `idrive7-apps`, que ya trae el `mgu-repo.json` que lee el [MGU Store](https://github.com/robertnisipeanu/mgu-store). El head unit la compila con el SDK que ya tiene: no hace falta compilar nada en un computador.

1. El carro necesita root SSH y el MGU Store instalados (ver el README del Store).
2. En el Store: **Settings → Add source** → `tu-usuario/idrive7-apps`, siguiendo la rama donde está la app.
3. Instalar **Track Day** desde la lista del Store. Pide un renderer; el Store lo ofrece si no hay uno.

El id de la app es `m240_track_day` (el Store pide un id con prefijo propio).

## Probar y construir en un computador (opcional)

Requisitos: Node.js 14+, Python 3.6+ y el SDK de BMW en `idrive7-apps/oap-sdk/`, que solo se obtiene del propio carro (README principal, sección 3.1).

```bash
node kit/tools/emu.js m240_track_day
```

```bash
python kit/tools/build.py m240_track_day
```

El `.mgu` de `dist/` no se publica: contiene el SDK de BMW.

## Créditos

- Kit, renderer y lectura de señales: [idrive7-apps](https://github.com/cauliflowermossgrape/idrive7-apps) (MIT), en especial M Vitals.
- Lectura del etanol de MHD: [Perea Performance, Flex Fuel](https://github.com/alexpereap/pereaperformance-idrive7-apps) (MIT, ver `NOTICE`).
