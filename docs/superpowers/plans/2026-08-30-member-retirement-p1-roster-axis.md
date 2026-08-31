# Spec: eje de retiro por ministerio (P1)

## Status

`DRAFT` — hijo 1 de 2 de `2026-08-30-member-retirement-roadmap.md`. Riesgo **estándar**.

## Original request

> Cómo manejaríamos lo del reference si quiero eliminar un miembro?
> Podríamos "deshabilitar" a los miembros en vez de borrarlos para mantener los datos históricos también?
>
> sí, levanta el spec del retiro suave
> Quiero conservar una forma de revocar el acceso de forma "rápida"

## Outcome

- **Primary outcome:** un miembro sale de las rotaciones de un ministerio conservando íntegro
  su historial, sin que eso toque su acceso a la app; y el kill switch de acceso se vuelve
  operable desde la app, visiblemente separado del retiro.
- **Intended user or operator:** administradores de worship y de kids; super-admin para el
  kill switch.
- **Problem and current behavior:** las dos salidas que existen hoy son la equivocada y la
  imposible. `teamMembers.disabled` revoca el acceso pero **no saca a nadie de ningún roster**:
  de 23 lecturas de `teamMembers` en `app/**`, una sola lo lee, y es la caché de auth. Un
  miembro deshabilitado sigue apareciendo en los pools del planner, en el dropdown de Persona
  de las reglas del solver y en las audiencias de correo. Borrar el documento sí lo saca de
  todo, pero destruye la identidad que el historial referencia — y falla, porque las cinco
  sedes de los role docs son referencias fuertes.
- **Success measure:** retirar a un miembro de worship lo saca de las enumeraciones de worship
  y de ninguna otra cosa: sigue apareciendo con su nombre en cada servicio pasado donde sirvió,
  sigue en kids si aplica, y su acceso a la app no cambia de estado.

## Evidence

| Fact | Source | Planning implication |
|---|---|---|
| `disabled`: `boolean`, `initialValue: false`, "kill switch. Reversible" | `sanity/schemas/worshipTeam.ts:50-54` | El eje de acceso ya existe. Este spec no lo redefine; le da UI. |
| `isMemberActive` = doc existe && `disabled !== true`; caché TTL 30 s | `app/utils/memberAccess.ts:53-77` | La latencia del "rápido" ya está medida. El retiro NO debe entrar a esta ruta ni a su caché. |
| Una sola de 23 lecturas de `teamMembers` menciona `disabled` | `grep '_type == "teamMembers"' app/** ` | Cuantifica el gap: `disabled` no es hoy un mecanismo de roster. |
| Las lecturas se parten en **enumeración** (`*[_type=="teamMembers" && <filtro>]`) y **resolución** (`_id in $ids`, `_id == $id`) | Inventario abajo | Regla central del spec. Filtrar una resolución rompería el historial y los correos de gente ya asignada. |
| `WORSHIP_AUDIENCE_GROQ_FILTER` / `WORSHIP_MEMBER_GROQ_FILTER`; el arm `!defined` "no es belt-and-braces: es el contrato de almacenamiento" | `app/ministries.ts:64-77` | El filtro nuevo debe componerse con estos, y escribir su arm de ausencia explícito por la misma razón. |
| `validateMinistryWrite` rechaza `ministries` vacío | `app/ministries.ts:100-109` | "Retirado de todo" no puede expresarse vaciando `ministries`. Necesita campo propio. |
| `normalizeMinistries`: ausente ⇒ `["worship"]` | `app/ministries.ts:41-44` | El campo nuevo debe seguir la misma regla libre de migración: ausente ⇒ sirve. |
| `kidsPair.active`: "Las parejas retiradas conservan su historial pero salen de todas las rotaciones" | `sanity/schemas/kidsPair.ts:43-48` | Precedente del patrón en este repo, con la semántica exacta buscada. |
| `draftGatingCoverage.test.ts`: escaneo invertido de `app/**`, exime por excepción; su encabezado documenta que "una frase en CLAUDE.md y N call sites correctos es un estado, no un mecanismo", y que la primera versión encontró una violación real preexistente | `app/utils/__tests__/draftGatingCoverage.test.ts:1-45` | Mecanismo probado y su modo de falla conocido: un filtro guardado en string e inyectado en otro lado es invisible a un escaneo de grupo. El guard de R2 debe cubrir esa forma. |
| Las cinco sedes de role docs son `reference` sin `weak: true` | `sanity/schemas/sunRole.ts:51,65,93,118,129` | El historial resuelve por referencia, no por copia de nombre: retirar no puede romperlo, y borrar ya está bloqueado. |
| El planner obtiene miembros de `GET /api/admin/members` | `app/components/admin/serviceSourceState.ts:141`, `AvailabilityPanel.tsx:69`, `AdminPanel.tsx:716` | Un solo punto de entrada alimenta pools, dropdown de reglas y ranking de candidatos. Filtrar ahí cubre las tres. |
| `AdminPanel` no tiene ningún control de `disabled` | `grep disabled app/components/admin/AdminPanel.tsx` | R7 es UI nueva sobre campo existente: sin esquema nuevo, sin lector nuevo. |

### Inventario de las lecturas de `teamMembers` en `app/**`

**Enumeración — DEBEN filtrar** (el ministerio indicado es el del filtro):

| Lectura | Ministerio | Por qué |
|---|---|---|
| `app/api/admin/members/route.ts:22` | worship | Alimenta pools del planner, dropdown de reglas y ranking de candidatos |
| `app/(client)/kids/admin/page.tsx` | kids | Roster de kids |
| `app/api/kids/members/route.ts` | kids | Roster de kids |
| `app/api/kids/generate/route.ts` | kids | Candidatos del generador de kids |
| `app/utils/serviceMutationSideEffects.ts:840` | worship | Audiencia de correo de setlist |
| `app/utils/proposalNotifyQueries.ts` (`role in ["super-admin","admin"]`) | worship | Audiencia de propuestas |

**Resolución — NUNCA filtran** (`_id in $ids` / `_id == $id`): `app/(client)/me/page.tsx`,
`app/api/me/route.ts`, `app/api/me/availability/route.ts`, `app/api/me/password/route.ts`,
`app/api/kids/members/[id]/availability/route.ts`, `app/api/kids/pairs/pairMembers.ts`,
`app/utils/assignmentEmail.ts` (×2), `app/utils/memberAccess.ts`, `app/utils/outboxSweep.ts`,
`app/utils/proposalNotify.ts`, `app/utils/proposalNotifyQueries.ts` (lead por id),
`app/utils/push.ts`, `app/utils/serviceReadQueries.ts`.

**Enumeración exenta, con razón declarada:**

| Lectura | Por qué se exime |
|---|---|
| `app/api/admin/login-events/route.ts:20` | Vista de auditoría de accesos. Ocultar a un retirado escondería precisamente el evento que interesa: que alguien fuera del roster entró. |
| `app/utils/outboxLiveness.ts` | Audiencia de **operador**, no roster: alerta a super-admins de que el outbox está atorado. Depende del rol, no de servir. |
| `app/ministries.ts:50` | Comentario de uso, no consulta ejecutable. |

## Requirements

| ID | Requirement | Rationale | Acceptance criterion |
|---|---|---|---|
| R1 | El retiro se almacena por ministerio, y la **ausencia del campo significa que sirve** | Decisión D1 del roadmap; contrato libre de migración que este repo ya usa en `published` y `ministries` | Los 57 documentos existentes, sin tocarlos, se leen como "sirve en todos sus ministerios" |
| R2 | Toda lectura de **enumeración** de `teamMembers` filtra a los retirados del ministerio que enumera | Es el gap que hace que `disabled` no sirva como retiro | Un guard automatizado falla si una enumeración nueva omite el filtro |
| R3 | Ninguna lectura de **resolución** filtra por retiro | Filtrarlas rompería el historial y los correos de gente ya asignada | Un retirado sigue resolviendo con nombre y foto en cada servicio pasado; el guard distingue las dos formas y no exige el filtro en resolución |
| R4 | `disabled` conserva significado, latencia y conjunto de lectores exactos | El usuario pidió explícitamente conservar el revocado rápido | Ninguna ruta nueva lee ni escribe `disabled` junto al retiro; `memberAccess.ts` sin cambios |
| R5 | Retirar no modifica ningún documento de servicio | Decisión D2: no reescribir lo que el equipo ya vio | Retirar emite exactamente una escritura, sobre el doc del miembro |
| R6 | Un ocupante retirado en un servicio **futuro** se señala en el planner | Contraparte obligada de R5: no tocar exige avisar | La sede muestra el aviso; el servicio no cambia solo |
| R7 | El kill switch es operable desde la app, en un control visiblemente distinto del retiro | El "rápido" pedido hoy pasa por Studio | Un super-admin revoca acceso sin salir de la app; los dos controles no se confunden |
| R8 | El boundary de escritura rechaza un retiro incoherente | Mismo estándar que `validateMinistryWrite` | Retirar de un ministerio al que el miembro no pertenece se rechaza con mensaje, no se normaliza en silencio |

## Scope

### In scope

- Campo nuevo en `sanity/schemas/worshipTeam.ts` y su despliegue de esquema.
- Helper de filtro GROQ compartido, junto a `WORSHIP_AUDIENCE_GROQ_FILTER` en `app/ministries.ts`.
- Aplicación del filtro a las seis enumeraciones listadas.
- Guard de cobertura automatizado, al estilo de `draftGatingCoverage.test.ts`.
- Validación de escritura, junto a `validateMinistryWrite`.
- UI en `AdminPanel`: control de retiro por ministerio y toggle de `disabled`, separados.
- Aviso en el planner para ocupante retirado en servicio futuro.
- Documentación: invariante en `CLAUDE.md`, y ADR si la revisión lo pide.

### Non-goals

- Migrar las reglas del solver de nombre a id (decidido en D4 del roadmap, entregado aparte).
- Arreglar la regla `5cbxwcm` que nombra `"Vale Sosa"` — es un dato, no código.
- Endurecer `DELETE` ni limpiar ids colgantes del `solverConfig` — eso es P2.
- Tocar `unavailableDates` / `unavailabilityNotes`: la indisponibilidad es temporal, por fechas
  y declarada por el propio miembro; el retiro es indefinido, sin fechas y administrativo.
- Retirar automáticamente a quien lleve N meses sin servir.
- Cambiar `kidsPair.active`.

## Behavior and invariants

- **Required behavior:** retirar de un ministerio saca al miembro de las enumeraciones de ese
  ministerio y de ninguna otra. Reversible sin pérdida.
- **Preserved behavior:** `disabled` (kill switch, TTL 30 s). El contrato `ministries` ausente
  ⇒ worship. El rechazo de `ministries` vacío. El aislamiento de ministerios en dos direcciones.
- **Data invariants:** ausencia ⇒ sirve. El campo sólo contiene ids de ministerio conocidos.
  Nunca se usa para expresar acceso.
- **Security invariants:** el retiro **no** concede ni revoca acceso. Un retirado con
  `disabled: false` sigue entrando y viendo su propio perfil e historial — deliberado: irse del
  equipo no debe borrar tu historial de tu propia vista.
- **Failure and recovery:** el retiro es una escritura de un campo sobre un documento. Falla
  → nada cambia. Revertir el código deja el campo sin lectores, con el sistema comportándose
  como hoy.

## Dependencies and constraints

- Despliegue de esquema a Sanity (`sanity:deploy-schema`) antes de que la UI escriba el campo.
- El guard de R2 debe cubrir el modo de falla ya documentado en `draftGatingCoverage.test.ts`:
  un filtro guardado en una constante e inyectado en otro archivo es invisible a un escaneo de
  grupo. Ese escaneo encontró una violación real preexistente sólo cuando se le añadió la
  comprobación de predicado suelto.
- Escrituras a Sanity de producción requieren consentimiento explícito (CLAUDE.md). Este spec
  no autoriza ninguna.

## Decisions

| Decision | Choice | Why | Tradeoffs | Owner |
|---|---|---|---|---|
| Forma del campo | `retiredFrom: MinistryId[]` | Ausente ⇒ sirve. "Retirado de todo" es representable sin vaciar `ministries`, que el boundary rechaza. Un booleano no puede expresar D1. | Un array donde D1-global habría permitido un booleano. Consecuencia directa de la elección del usuario. | P1 |
| Semántica del filtro | `!defined(retiredFrom) || !("<min>" in retiredFrom)` | Arm de ausencia explícito, por la misma razón que `app/ministries.ts:64` lo escribe: es el contrato, no defensa. | Más verboso que confiar en la semántica de `in` sobre `undefined`. | P1 |
| Escritura incoherente | Se rechaza, no se normaliza | Normalizar en silencio es cómo `"Vale Sosa"` sobrevivió invisible. | Un error más que manejar en la UI. | P1 |
| `disabled` intacto | Sí | Petición explícita del usuario. | Dos controles en pantalla en vez de uno. Es el punto. | Frank |

## Assumptions

| Assumption | Impact if false | Validation | Failure response |
|---|---|---|---|
| El inventario de 23 lecturas está completo y bien clasificado | Filtrar de más rompe historial; de menos deja el gap | Reejecutar el grep como primer paso de implementación; el guard lo vuelve continuo | Reclasificar y ajustar el guard antes de tocar código |
| Las tres exenciones son correctas | Un retirado recibiría alertas de operador, o un evento de acceso quedaría oculto | Revisión adversarial de este spec | Convertir la exención en filtro; el guard las lista explícitamente |
| Nadie depende hoy de que un deshabilitado siga en los pools | El filtro cambiaría comportamiento esperado | Ninguna: `disabled` no se filtra hoy, así que este spec no altera ese caso | — |

## Open questions

| Question | Why it matters | Recommendation and why | Tradeoffs | Owner | Blocking? | Resolution point | Bounded default |
|---|---|---|---|---|---|---|---|
| ¿Retirar de todos los ministerios sugiere revocar acceso? | Es el único punto donde los dos ejes se tocan | **Sugerir, nunca automatizar.** Automatizar reintroduce el acoplamiento que motivó separarlos | Un paso manual en el caso más común | Frank | No | Diseño de UI | Sugerencia, no automatismo |
| ¿Admin o sólo super-admin puede retirar? | `DELETE` es super-admin-only; `PATCH` de miembro no | **Admin.** Es reversible y no destructivo; restringirlo empujaría a usar el borrado en su lugar | Más gente puede sacar a alguien de las rotaciones | Frank | No | Implementación | Admin, alineado con el `PATCH` existente |
| ¿La audiencia de propuestas debe filtrar retiro? | Es enumeración por rol, no por roster | **Filtrar.** Un admin retirado de worship no debería recibir propuestas de worship | Si un admin gestiona sin servir, dejaría de enterarse | Frank | No | Implementación | Filtrar |

## Acceptance and verification

| Requirement | Acceptance evidence | Verification method |
|---|---|---|
| R1 | Un doc sin el campo se lee como "sirve" en ambos ministerios | Test unitario del normalizador, con un doc sin el campo |
| R2 | Las seis enumeraciones filtran | Guard de cobertura sobre `app/**`, invertido y con exenciones declaradas; falla al añadir una enumeración sin filtro |
| R3 | Un retirado resuelve con nombre en un servicio pasado | Test de integración sobre `serviceReadQueries`; el guard NO exige filtro en formas de resolución |
| R4 | `memberAccess.ts` sin cambios; ninguna ruta nueva toca `disabled` junto al retiro | Diff vacío en ese archivo + escaneo del guard |
| R5 | Retirar emite una sola escritura, sobre el doc del miembro | Test que cuenta las mutaciones del handler |
| R6 | El aviso aparece; el servicio no cambia | Test de componente del planner con un ocupante retirado |
| R7 | Un super-admin revoca acceso desde la app | Test de componente + verificación visual |
| R8 | El retiro incoherente se rechaza con mensaje | Test unitario del validador, junto a los de `validateMinistryWrite` |

## Terminal state

`READY_FOR_ADVERSARIAL_REVIEW` — las tres preguntas abiertas son no bloqueantes y tienen
default acotado. Riesgo estándar: una ronda fría de aprobación.
