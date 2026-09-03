# Spec: borrado de miembros que falla legible y no deja rastro colgante (P2)

> **Still in force after ADR-0029.** Its siblings (P1, P3, the roadmap) were superseded
> when soft retirement was removed; this one is not — `app/utils/memberDelete.ts` still
> implements it. Only the message pointing at retirement changed.

## Status

`APPROVED` — hijo 3 de 3 de `2026-08-30-member-retirement-roadmap.md`.
Digest aprobado: `d42ad3e99b93205e3828c49ea14bf64da9199e461e3a785d7ebcbaf3833a7992`
(P2.2 + P2.3, 2026-08-31). **La aprobación de un plan nunca autoriza implementar.**

## Original request

> Cómo manejaríamos lo del reference si quiero eliminar un miembro?
> Podríamos "deshabilitar" a los miembros en vez de borrarlos para mantener los datos históricos también?

## Outcome

- **Primary outcome:** borrar un miembro deja de ser una operación que falla sin explicar o
  que triunfa dejando basura. Con historial: falla diciendo por qué y ofrece retirar. Sin
  historial: borra limpio, incluyendo las referencias que Sanity no protege.
- **Intended user or operator:** super-admin (única función que puede borrar hoy).
- **Problem and current behavior:** el handler es `await writeClient.delete(id)` sin try/catch
  (`app/api/admin/members/[id]/route.ts:119`). Las cinco sedes de los role docs son referencias
  fuertes, así que Sanity rechaza borrar a quien haya servido — y también quien aparece en
  `loginEvent`, `kidsPair` o `setlistProposal` (referencias fuertes adicionales). La excepción
  sale como 500 y la UI muestra el genérico *"Error al eliminar."* (`AdminPanel.tsx:826`).
  los pools del `solverConfig` (`sundayLeads`/`saturdayLeads`/`support`) guardan ids como
  **strings planos**, sin integridad referencial — así que un borrado que sí procede deja ids
  colgando ahí, invisibles.
- **Success measure:** ningún borrado termina en un mensaje que no explica nada, y ningún
  borrado exitoso deja un id apuntando a un documento inexistente.

## Evidence

| Fact | Source | Planning implication |
|---|---|---|
| `DELETE` es `await writeClient.delete(id)` sin try/catch, tras dos guards de rol | `app/api/admin/members/[id]/route.ts:105-123` | El fallo por integridad no está manejado; sale como excepción no atrapada. |
| La UI reporta `res.ok ? "Miembro eliminado." : "Error al eliminar."` | `app/components/admin/AdminPanel.tsx:823-826` | El mensaje no distingue "no se puede porque tiene historial" de "se cayó la red". |
| Las cinco sedes de role docs son `reference` a `teamMembers`, sin `weak: true` | `sanity/schemas/sunRole.ts:51,65,93,118,129` | Sanity bloquea el borrado de quien sirvió. Ese es el caso común, y hoy es el que peor se comunica. |
| Hay referencias fuertes adicionales fuera de los role docs | `loginEvent.ts:27-28`; `kidsPair.ts:26`; `setlistProposal.ts:47-48,60,75-76,82-83,187-188` | R8 debe cubrir **cualquier** rechazo por integridad referencial, no sólo role docs. |
| Los pools del `solverConfig` son arrays de string, no de referencia | `sanity/schemas/solverConfig.ts:68-79`; consulta a producción 2026-08-30 (`support` contiene `gJgJ2wc44ylNYNyNTYYu5k`) | Sanity NO protege aquí. Es el rastro colgante que el borrado deja hoy. |
| Las reglas del `solverConfig` guardan **nombres**, no ids | mismo esquema, `person`/`personA`/`personB`/`persons` son `string` | Una regla que nombra a un borrado no queda colgante sino inerte, y ya la reporta `unresolvedRuleNames`. No es trabajo de este spec. |
| El retiro por ministerio (P1 spec aprobado) | `2026-08-30-member-retirement-p1-roster-axis.md` | Es lo que el mensaje de error puede ofrecer como alternativa. Prerrequisito de implementación, no código en el árbol actual. |
| Las escrituras a Sanity de producción requieren consentimiento explícito y dry-run previo | CLAUDE.md | Cualquier limpieza retroactiva de ids ya colgantes es una operación aparte y consentida. |

## Requirements

**Este spec es la fuente única del texto normativo de los requisitos que posee.** El roadmap
padre los mapea por id y por una etiqueta estable, y no copia este texto. Los ids son únicos en
toda la familia; `R1`–`R7`, `R2b`, `R11`, `R14`, `R16` y `R18` pertenecen a P1; `R10`, `R15`,
`R15b` y `R17` a P3. No aparecen aquí.

| ID | Requirement | Rationale | Acceptance criterion |
|---|---|---|---|
| R8 | Borrar a quien tiene historial —cualquier referencia fuerte a `teamMembers`, no sólo role docs— falla con una razón legible y ofrece retirar | Es el caso común y hoy es indistinguible de un fallo de red | La respuesta identifica la causa (integridad referencial); la UI la muestra y enlaza al retiro |
| R9 | Un borrado que procede no deja ids colgando en los tres pools del `solverConfig`. La limpieza va **revision-guarded** (`rev` observado + `ifRevisionId`, mismo contrato que `app/api/admin/solver-config/route.ts:37-41`) y clasifica conflictos con `sanityConflictKind` | Sanity no protege los pools; hoy el rastro queda invisible. Sin guarda, un “Guardar reglas” concurrente puede pisar la limpieza o dejar el id colgante sin camino definido — segundo writer destructivo al mismo singleton | Tras borrar, el id no aparece en ninguno de los tres pools; `stale_revision` en la limpieza no revierte el borrado |
| R9b | Si el borrado del miembro **ya aterrizó** y la limpieza de pools falla (red, `stale_revision`, otro error), la respuesta es **no-2xx** con código `member_deleted_pool_cleanup_failed`, mensaje en español que dice que el miembro **sí fue eliminado** y que su id puede seguir en un pool, y **sin** `revalidateServiceViews` / `revalidatePath` en ese camino | El orden delete-first deja un estado parcial recuperable; hoy `!res.ok` → “Error al eliminar.” y el operador cree que el miembro sigue existiendo | Test del handler: delete OK + cleanup fail → código distinto, sin revalidate; UI muestra el mensaje parcial, no el genérico |
| R12 | La comprobación previa y el borrado no pueden divergir | Un chequeo "¿tiene historial?" seguido de un borrado es una carrera | La operación es segura si alguien adquiere historial entre ambos pasos |
| R13 | El borrado sigue siendo super-admin-only | Comportamiento existente que no hay razón para relajar | Los dos guards de rol se conservan |

**R9 no es R10.** R10 vive en **P3** y hace que un *retirado* deje de ser asignable aunque su id siga en un pool: el id se conserva, porque el retiro es reversible. R9 aquí trata el *borrado*, donde el id debe irse: el documento ya no existe y conservarlo no reserva nada. Los dos tocan los mismos tres arrays por razones opuestas, y confundirlos produce o un retiro que borra estado recuperable, o un borrado que deja basura. Los identificadores son únicos en toda la familia por esa razón.

## Scope

### In scope

- Endurecer `DELETE /api/admin/members/[id]`: distinguir el rechazo por integridad
  referencial de un fallo genérico, y responder con una causa que la UI pueda mostrar.
- Limpiar el id del miembro de los tres pools del `solverConfig` como parte del borrado.
- Mensajería en `AdminPanel`: causa legible y salida hacia el retiro.
- Definir el orden de operaciones y qué pasa si una mitad falla.

### Non-goals

- Cambiar quién puede borrar.
- Migrar las reglas del solver a ids (D4 del roadmap).
- Limpiar retroactivamente ids ya colgantes en producción. Es una escritura de datos que
  requiere consentimiento y dry-run propios; este spec sólo evita crear más.
- Borrado en cascada de documentos de servicio. Nunca: es el historial que todo esto protege.
- Tocar `unresolvedRuleNames` o las reglas por nombre.

## Behavior and invariants

- **Required behavior:** el borrado exitoso completo elimina el miembro y limpia los tres pools.
  Si la limpieza falla tras un borrado exitoso, el operador recibe el contrato de R9b — no el
  genérico “Error al eliminar.”
- **Preserved behavior:** super-admin-only; `revalidateServiceViews()` y `revalidatePath("/me")`
  se siguen llamando en el camino exitoso.
- **Security invariants:** los dos guards de rol se ejecutan antes de cualquier lectura o
  escritura, como hoy.
- **Failure and recovery:** el modo de falla que importa es el borrado parcial. **El orden está
  decidido: primero el borrado, después la limpieza de pools (revision-guarded, R9).** Eso deja
  exactamente un estado parcial posible —documento borrado, id todavía en un pool— recuperable
  (reintentar limpieza o script consentido). R9b define la UX de ese caso. El orden inverso
  produciría retiro silencioso — prohibido. En `stale_revision` tras borrar, el operador reintenta
  la limpieza con un `rev` fresco; el borrado no se revierte.
- **Concurrencia:** entre comprobar historial y borrar, alguien puede asignar a esa persona.
  R12 exige que ese caso no produzca un borrado que rompa el historial. La integridad
  referencial de Sanity es la red final y debe seguir siendo la autoridad, no la comprobación
  previa.

## Dependencies and constraints

- **Depende de P1** entregado: sin retiro no hay alternativa que ofrecer.
- El plan de implementación debe verificar empíricamente, en un dataset no productivo, que
  Sanity efectivamente rechaza el borrado de un miembro referenciado. Toda la utilidad de R8
  descansa en ese comportamiento, y en este spec es una suposición leída del esquema, no
  observada.

## Decisions

| Decision | Choice | Why | Tradeoffs | Owner |
|---|---|---|---|---|
| Conservar el borrado duro | Sí, endurecido | Sigue siendo correcto para un documento creado por error que nunca sirvió | Mantiene una ruta destructiva en la app | Frank |
| Autoridad sobre "¿se puede borrar?" | La integridad de Sanity, no la comprobación previa | Una comprobación previa es una foto; entre ella y el borrado el mundo cambia | El mensaje bonito depende de interpretar un error del proveedor | P2 |
| Orden de operaciones | **La limpieza de pools va DESPUÉS del borrado** | Elección de Frank. Define cuál es el único estado parcial posible, y lo elige a favor del recuperable: si la limpieza falla tras un borrado exitoso queda un id colgante — el estado de hoy, no peor — mientras que limpiar primero y fallar el borrado dejaría a alguien fuera de las rotaciones sin que nadie lo decidiera, o sea un **retiro silencioso**, que es justo lo que P1 existe para volver explícito. | Un id colgante tras un fallo parcial. Detectable y recuperable; el plan de implementación debe decir cómo se detecta. | Frank |
| Limpieza retroactiva | Fuera de alcance | Es escritura a datos de producción; necesita consentimiento y dry-run propios | Los ids colgantes que ya existan siguen ahí hasta una operación aparte | Frank |

## Assumptions

| Assumption | Impact if false | Validation | Failure response |
|---|---|---|---|
| Sanity rechaza borrar un doc referenciado por referencias fuertes | R8 se queda sin caso real y P2 pierde su motivo principal | Prueba empírica en dataset no productivo, **antes** de implementar | Si el borrado procede, el historial está en riesgo hoy: P2 sube de prioridad y cambia de forma |
| El error de integridad es distinguible programáticamente de otros fallos | El mensaje legible no se puede construir | Misma prueba empírica: capturar la forma real del error | Degradar a un mensaje que no afirma la causa, y ofrecer el retiro igual |
| Los tres pools son el único lugar **de solver** donde un id de miembro se guarda sin referencia | Quedaría otro rastro colgante en pools sin cubrir | Escaneo de esquemas por arrays de string en `solverConfig` | Ampliar R9 a lo que aparezca. `notificationOutbox.memberId` es string plano pero fuera de alcance (cola transitoria) |

## Open questions

| Question | Why it matters | Recommendation and why | Tradeoffs | Owner | Blocking? | Resolution point | Bounded default |
|---|---|---|---|---|---|---|---|
| ¿Se ofrece "retirar en su lugar" como acción de un clic? | Cambia el alcance de UI | **Sí**, si P1 ya expone la mutación | Más superficie en el modal de borrado | Frank | No | Implementación | Enlace al control de retiro, sin acción directa |

## Acceptance and verification

| Requirement | Acceptance evidence | Verification method |
|---|---|---|
| R8 | Borrar a alguien con historial produce una causa identificable, y la UI la muestra | Test del handler con el error de integridad simulado + test de componente del modal |
| R9 | Tras borrar, id absent from pools; cleanup revision-guarded | Test mutaciones + `stale_revision` no revierte delete |
| R9b | Delete OK + cleanup fail → `member_deleted_pool_cleanup_failed`, sin revalidate | Test handler + componente UI |
| R12 | Adquirir historial entre la comprobación y el borrado no rompe nada | Test de la secuencia; la autoridad final es el rechazo de Sanity |
| R13 | Los dos guards de rol se conservan | Test de que un `admin` recibe 403 |

## Terminal state

`READY_FOR_ADVERSARIAL_REVIEW` — sin preguntas bloqueantes. La del orden de operaciones lo era
y Frank la decidió el 2026-08-31: la limpieza va después del borrado, registrado arriba como
decisión suya. La pregunta restante es no bloqueante y tiene default acotado. Riesgo **crítico**:
dos `APPROVED` frescos y consecutivos sobre bytes idénticos.
