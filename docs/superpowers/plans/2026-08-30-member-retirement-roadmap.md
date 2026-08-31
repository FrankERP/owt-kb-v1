# Artifact Roadmap: retirar miembros sin borrarlos, sin colapsar el kill switch

## Original request

> Cómo manejaríamos lo del reference si quiero eliminar un miembro?
> Podríamos "deshabilitar" a los miembros en vez de borrarlos para mantener los datos históricos también?
>
> sí, levanta el spec del retiro suave
> Quiero conservar una forma de revocar el acceso de forma "rápida"

## Parent scope

- **Shared outcome:** un miembro puede salir de las rotaciones de un ministerio conservando
  íntegro su historial, sin que eso toque su acceso a la app — y revocar el acceso sigue
  siendo una acción inmediata y separada.
- **Current gap:** hoy sólo existen dos salidas, y ninguna es la que se quiere.
  `teamMembers.disabled` revoca el acceso pero **no saca a nadie de ningún roster** (lo lee
  una sola de las 22 consultas ejecutables: la caché de auth). Borrar el documento sí lo saca de todo, pero
  destruye la identidad que el historial referencia — y de hecho falla, porque los role docs
  usan referencias fuertes. El resultado práctico es que un miembro que ya no sirve se queda
  en los pools del planner, en el dropdown de reglas del solver y en las audiencias de correo,
  indefinidamente.
- **Global requirements:** ver la tabla de cobertura. En una frase: un eje nuevo de *roster*,
  por ministerio, aplicado en el punto de **selección** y jamás en el de **resolución** — y que
  además alcanza las **referencias de roster ya almacenadas**, no sólo las consultas.

  **La distinción no vive en la consulta GROQ, vive en el punto de uso.** La primera versión de
  este roadmap decía "filtrar las lecturas de enumeración", y eso es insuficiente y además
  activamente dañino: el planner obtiene UNA lista de `GET /api/admin/members` y la usa para
  las dos cosas. `buildSolveRequest` mapea los ids de los pools con `memberIdToName`, que **cae
  al id crudo** cuando el miembro no está en la lista (`plannerModel.ts:566-568`, usado en
  `:641-645`): un retirado no sale del pool — entra al solve request como una persona llamada
  `gJgJ2wc44ylNYNyNTYYu5k` y se le sigue asignando, en silencio, porque `unresolvedRuleNames`
  nunca inspecciona ids de pool. Y si además tiene una regla, `resolvedNameOrRaw` la reinyecta
  en `support` bajo su nombre crudo (`plannerModel.ts:554-557, 648-661`) — fabricando más del
  síntoma `"Vale Sosa"` que este roadmap cita como defecto motivante.
- **Preserved invariants:**
  - `disabled` conserva su significado actual, exacto y único: kill switch de acceso,
    reversible, efectivo en segundos (TTL de 30 s en `memberAccess.ts`). El retiro **no** lo
    toca y no lo implica.
  - El contrato de almacenamiento de ministerios se mantiene: `ministries` ausente ⇒ worship;
    `ministries` explícitamente vacío se rechaza en todo boundary de escritura
    (`validateMinistryWrite`, `app/ministries.ts:107`).
  - Ausencia del campo nuevo significa **sirve**, nunca lo contrario. Los 57 documentos
    existentes preceden al campo, igual que precedieron a `published` y a `ministries`.
  - Ningún servicio ya publicado cambia de contenido como efecto secundario de retirar.
  - Aislamiento de ministerios en dos direcciones (CLAUDE.md, `authGuards.ts`).
  - **`disabled` sigue siendo reversible DESDE LA APP, no sólo en principio.** Hoy el campo
    sólo se escribe en Studio, así que quien lo apaga ya está del otro lado de la puerta. R7
    mueve esa escritura a la app y con ella aparece un modo de bloqueo que hoy no existe:
    `auth.ts:52` y `:79` rechazan el login de un deshabilitado, y el control nuevo vive en una
    pestaña `roles: ["super-admin"]` detrás de una ruta super-admin-only. Un super-admin que se
    deshabilite a sí mismo — o al último otro super-admin — deja la superficie de
    administración sin forma de deshacerlo desde la app. `proxy.ts:15-19` abre `/studio` mirando
    sólo el rol del token, así que una sesión aún viva podría rescatarlo, pero eso es suerte de
    vigencia de sesión, no una propiedad. La recuperación real es tener credenciales de escritura
    de Sanity, fuera de la app. Ver R14.
- **Non-goals:**
  - Migrar las reglas del solver de nombre a id. Es trabajo aparte; este spec **decide su
    diseño** (ver Decisión D4) pero no lo entrega.
  - Cambiar `unavailableDates` / `unavailabilityNotes`. La indisponibilidad es un eje distinto
    y ya existente: temporal, por fechas, declarada por el propio miembro. El retiro es
    indefinido, sin fechas y administrativo.
  - Cualquier cambio al solver (`gcf/owt_solver_v2.py`).
  - Retirar parejas de kids (`kidsPair.active` ya existe y no se toca).
- **Integration acceptance:** con P1 y P2 entregados, un super-admin puede (a) retirar a un
  miembro de worship desde la app y verlo desaparecer del dropdown de reglas, del ranking de
  candidatos y de las audiencias de correo de worship, **y dejar de ser asignable por el solver
  aunque su id siga en un pool**, conservándolo en kids si aplica; (b) verlo seguir
  apareciendo, con su nombre, en todo servicio pasado donde sirvió; (c) revocarle el acceso
  desde la misma pantalla con un control visiblemente distinto; y (d) recibir un error legible
  —con la opción de retirar— al intentar borrar a alguien con historial.

## Evidence

| Fact | Source | Planning implication |
|---|---|---|
| `disabled` existe, `initialValue: false`, descrito como "kill switch. Reversible" | `sanity/schemas/worshipTeam.ts:50-54` | No hay que inventar el eje de acceso: ya está, y hay que dejarlo intacto. |
| `isMemberActive` = doc existe && `disabled !== true`, caché TTL 30 s | `app/utils/memberAccess.ts:56,75` | El "rápido" que pidió el usuario ya está medido: 30 s. El retiro no debe entrar a esta ruta. |
| De 23 lecturas de `teamMembers` en `app/**`, **1** menciona `disabled` — la de auth | `grep` sobre `app/**` | `disabled` hoy NO saca a nadie de ningún roster. Es la razón por la que "deshabilitar en vez de borrar" no funciona todavía. |
| Las lecturas se parten en enumeración (`*[_type == "teamMembers" && <filtro>]`) y resolución (`_id in $ids` / `_id == $id`) | Inventario en P1 | Base de la regla, **pero no la regla**: el corte se aplica en el punto de USO, no en la consulta — ver Global requirements. Una misma lista puede servir a los dos roles, y `GET /api/admin/members` es justamente ese caso. |
| Las cinco sedes de role docs son `reference` a `teamMembers`, sin `weak: true` | `sanity/schemas/sunRole.ts:51,65,93,118,129` | Sanity ya bloquea borrar a quien haya servido. El borrado duro no es una vía de salida real hoy. |
| `DELETE` hace `await writeClient.delete(id)` sin try/catch | `app/api/admin/members/[id]/route.ts:119` | Un borrado rechazado por integridad sale como 500 y la UI dice sólo "Error al eliminar". |
| Los pools del `solverConfig` (`sundayLeads`/`saturdayLeads`/`support`) guardan ids como strings planos | consulta a producción, 2026-08-30 | Sin integridad referencial: un borrado deja ids colgando ahí. Bug latente preexistente, en P2. |
| `kidsPair.active`: "Las parejas retiradas conservan su historial pero salen de todas las rotaciones" | `sanity/schemas/kidsPair.ts:43-48` | Precedente del patrón EN ESTE REPO, con la semántica exacta que se busca. |
| `validateMinistryWrite` rechaza `ministries` vacío | `app/ministries.ts:107` | El campo nuevo debe poder expresar "retirado de todo" sin recurrir a vaciar `ministries`. |
| `buildSolveRequest` mapea ids de pool con `memberIdToName`, que cae al **id crudo** si el miembro no está en la lista; `resolvedNameOrRaw` reinyecta a todo nombrado-por-regla ausente de los pools en `extraSupport` | `app/components/admin/plannerModel.ts:554-557, 566-568, 641-645, 648-661` | Filtrar la lista de miembros NO saca a un retirado del solve request: lo vuelve un id crudo asignable, o lo reinyecta bajo su nombre. Origen de R10. |
| `unresolvedRuleNames` sólo inspecciona nombres de reglas, nunca ids de pool | `app/components/admin/ruleEnforcement.ts:225-249` | El fallo anterior sería silencioso: ningún reporte existente lo vería. |
| `PATCH /api/admin/members/[id]` es **super-admin-only**, igual que `DELETE`; la pestaña Miembros es `roles: ["super-admin"]` | `app/api/admin/members/[id]/route.ts:19-22`; `app/components/admin/AdminPanel.tsx:567` | Corrige una afirmación falsa de la primera versión. Retirar con rol `admin` no sería alineación sino ensanchamiento de ACL. |
| `ADMIN_RECIPIENTS_QUERY` no tiene filtro de ministerio alguno | `app/utils/proposalNotifyQueries.ts:34` | Componerle un filtro de retiro *de worship* exige decidir antes qué significa para un admin sólo-kids. |
| `draftGatingCoverage.test.ts` es un escaneo invertido de `app/**` que exime por excepción | `app/utils/__tests__/draftGatingCoverage.test.ts` | Mecanismo ya probado para invariantes de filtro. El retiro necesita el suyo, o repite la historia: "una frase en CLAUDE.md y N call sites correctos, que es un estado, no un mecanismo". |
| La regla `5cbxwcm` del `solverConfig` nombra a `"Vale Sosa"`, que no resuelve a nadie | consulta a producción, 2026-08-30 | Caso real que motiva D4. No lo arregla este spec. |

## Decomposition rationale

**P1 y P2 se separan por dependencia y despliegue independiente.** P1 es útil y desplegable
solo; P2 depende de él, porque su mensaje de error ofrece "retirar en su lugar" y eso exige que
el retiro exista. Cada uno tiene su propio contrato de aceptación, se verifica de forma
independiente y tiene un estado final seguro por sí mismo.

**La partición NO ahorra costo de revisión, y una versión anterior de esta sección afirmaba que
sí.** Decía que P1 era "aditivo — riesgo estándar" y que fusionarlo con P2 le cobraría el
precio de la mitad peligrosa. Eso quedó falso en cuanto R7 se reconoció como una ruta de
escritura sobre el gate de acceso: **ambos hijos son críticos** y ambos pagan dos `APPROVED`.
Se deja escrito porque un lector que sólo abra esta sección se saltaría el segundo `APPROVED`
sobre un cambio al gate de autenticación.

**El toggle de `disabled` se queda DENTRO de P1, no se separa.** Podría desplegarse solo, y es
pequeño. Pero el resultado que P1 persigue no es "existe un campo de retiro": es que un
administrador vea **los dos ejes juntos y no los confunda**. Entregar el retiro sin el kill
switch deja una pantalla que muestra un eje y esconde el otro en Studio — que es exactamente el
estado confuso de hoy, a medio cambiar, y el que hace que alguien retire creyendo que revocó.
Ese es un estado intermedio inseguro en el sentido del test de alcance, no una preferencia
estética.

**P2 depende de P1** y no al revés: el mensaje de error del borrado ofrece "retirar en su lugar",
lo cual requiere que el retiro exista. P1 es desplegable y útil sin P2.

## Child plans

| ID | Artifact type | Outcome and acceptance contract | Prerequisites | Outputs | Safe ending state | Rollback or recovery | Review order |
|---|---|---|---|---|---|---|---|
| P1 | Spec | Eje de retiro por ministerio: esquema, filtro de enumeración, guard de cobertura, UI de administración con los dos ejes separados, advertencia en el planner. Aceptado cuando un retirado desaparece de las enumeraciones de ese ministerio, sigue resolviendo en el historial, y `disabled` conserva su comportamiento medido. | Ninguno | Campo persistido; filtro GROQ compartido; test de cobertura; UI | Desplegable solo. Sin ningún miembro retirado, el sistema se comporta idéntico a hoy. | El campo es aditivo: revertir el código deja documentos con un campo que nadie lee. Sin pérdida de datos. | 1 |
| P2 | Spec | Borrado duro que falla legible y limpia lo que Sanity no protege. Aceptado cuando borrar a alguien con historial explica por qué y ofrece retirar, y borrar a alguien sin historial no deja ids colgando en `solverConfig`. | P1 | `DELETE` endurecido; limpieza de pools | Desplegable solo una vez P1 está. | Writer destructivo: el plan de implementación debe definir su propia recuperación. | 2 |

## Requirement-to-plan coverage

| Requirement ID | Requirement | Primary owner plan | Dependent plans | Verification owner | Coverage note |
|---|---|---|---|---|---|
| R1 | El retiro es por ministerio y ausencia significa "sirve" | P1 | — | P1 | Decisión del usuario, contra la recomendación; ver D1. |
| R2 | La **selección** (quién puede ser elegido o enumerado) excluye a los retirados de ese ministerio | P1 | — | P1 | Guard de cobertura, no revisión manual. |
| R2b | Las enumeraciones **exentas** se declaran con razón escrita, no se omiten | P1 | — | P1 | Sin esto el guard exigiría filtrar `outboxLiveness`, silenciando la alarma de outbox atorado para un super-admin retirado. |
| R3 | La **resolución** (`_id in $ids`, `_id == $id`, id→nombre de pool, ocupante histórico) NUNCA filtra | P1 | P2 | P1 | El guard distingue las formas; la resolución id→nombre contra una lista filtrada es un caso nombrado y manejado, no sin clasificar. |
| R10 | (P1) El retiro alcanza las **referencias de roster ya almacenadas**: un retirado deja de ser asignable por el solver aunque su id siga en un pool, y no se le reinyecta vía regla | P1 | — | P1 | Sin esto R2 por sí solo produce un id crudo asignable en el solve request. Es lo que hace entregable la aceptación de integración (a). |
| R4 | `disabled` conserva significado, latencia y lectores exactos | P1 | — | P1 | Verificación negativa: ninguna ruta nueva lo lee ni lo escribe junto al retiro. |
| R5 | Retirar no modifica ningún servicio ya publicado | P1 | — | P1 | Decisión D2. |
| R6 | Un ocupante retirado en un servicio futuro se señala en el planner | P1 | — | P1 | Es la contraparte de R5: no tocar exige avisar. |
| R7 | El kill switch es operable desde la app, visiblemente distinto del retiro | P1 | — | P1 | Es la razón por la que P1 es crítico: ruta de escritura nueva sobre el gate de acceso. |
| R14 | El control de kill switch **rechaza** deshabilitar la sesión que actúa o al último super-admin habilitado | P1 | — | P1 | Sin esto, R7 introduce un bloqueo de la superficie de administración recuperable sólo con credenciales de Sanity. |
| R8 | Borrar a quien tiene historial falla con una razón legible y ofrece retirar | P2 | P1 | P2 | Depende de que el retiro exista. |
| R11 | El boundary de escritura rechaza un retiro incoherente | P1 | — | P1 | Mismo estándar que `validateMinistryWrite`: rechazar, no normalizar en silencio. |
| R12 | En P2, la comprobación de historial y el borrado no pueden divergir | P2 | — | P2 | Concurrencia: la autoridad final es el rechazo de Sanity, no la comprobación previa. |
| R13 | El borrado sigue siendo super-admin-only | P2 | — | P2 | Comportamiento existente que se preserva explícitamente. |
| R9 | **Borrar** no deja ids colgando en los pools del `solverConfig` | P2 | — | P2 | Bug preexistente, independiente del retiro. Distinto de R10: R9 es borrado, R10 es retiro. |

## Sequence and safe states

| Transition | Entry criteria | Allowed release state | Exit criteria | Recovery if interrupted |
|---|---|---|---|---|
| Start → P1 | Spec P1 aceptado | Desplegable a producción | Un miembro retirado en un ministerio sale de sus enumeraciones y sigue en el historial; `disabled` sin cambio observable | Revertir el código; el campo queda huérfano y sin lectores. Ningún documento pierde datos. |
| P1 → P2 | P1 en producción y verificado | Desplegable a producción | Borrado con historial falla legible; sin historial, limpio | Writer destructivo: lo define el plan de implementación de P2. |

## Shared decisions

| Decision | Choice | Why | Tradeoffs | Owner |
|---|---|---|---|---|
| D1 Alcance del retiro | **Por ministerio** | Elección del usuario. Cubre "salió de alabanza pero sigue en kids" sin vaciar `ministries`, que el boundary de escritura rechaza. | **Recomendé global y el usuario eligió por ministerio.** El costo es real y queda registrado: un tercer eje que cruzar con `ministries` y `disabled`, el filtro y su guard duplicados en las dos mitades, y más superficie de UI. Se acepta a cambio de no forzar el caso mixto a través de `ministries`. | Frank |
| D2 Asignaciones futuras al retirar | No se tocan; se señalan | El retiro es un hecho del roster, no una edición del calendario. Vaciar sedes reescribiría servicios que el equipo ya vio y podría disparar correos de cambio de rol. | Queda trabajo manual por servicio. Se mitiga con R6. | Frank |
| D6 Actor del retiro | Super-admin-only | La primera versión afirmaba que `PATCH` de miembro no era super-admin-only y derivaba de ahí un default de `admin`. **Es falso**: `route.ts:19-22` lo rechaza, el propio archivo lo comenta, y la pestaña Miembros es `roles: ["super-admin"]`. Alinear con la realidad evita un ensanchamiento de ACL que nadie pidió ni valoró. | Un super-admin en el camino de cada retiro. Se abre después si duele, con su propio tier. | Frank |
| D3 Borrado duro | Se conserva, endurecido | Sigue siendo la salida correcta para un documento creado por error que nunca sirvió. | Mantiene una ruta destructiva en la app. Se acota: super-admin-only, falla legible. | Frank |
| D4 Reglas del solver por id | **Fuera de alcance, pero este spec fija su diseño** | Si nadie se borra nunca, el argumento de integridad referencial a favor de `reference` se cae: un id en string plano basta y queda simétrico con los pools, que ya son strings. | Un miembro borrado por Studio seguiría sin protección. Aceptable: P2 acota el borrado y el historial ya lo bloquea. | Frank |
| D5 Forma del campo | `retiredFrom: MinistryId[]` | Ausente ⇒ sirve en todos sus ministerios, que es la regla libre de migración que este repo ya usa dos veces (`published`, `ministries`). "Retirado de todo" es representable sin vaciar `ministries`. | Un array donde un booleano bastaría si D1 hubiera sido global. Consecuencia directa de D1. | P1 |

## Shared assumptions

| Assumption | Impact if false | Validation | Failure response |
|---|---|---|---|
| Ninguna lectura de resolución depende hoy de que el miembro esté en un roster | Filtrar de más rompería historial o correos a gente ya asignada | El inventario de las 23 lecturas en P1, clasificadas una por una | Reclasificar la lectura y ajustar el guard antes de implementar |
| Las referencias fuertes de los role docs bloquean el borrado en la práctica, no sólo en el esquema | R8 quedaría sin caso real que manejar y P2 perdería su motivo principal | Prueba en un dataset no productivo antes de implementar P2 | Si Sanity permite el borrado, P2 sube de prioridad: el historial estaría en riesgo hoy |
| 57 miembros y ~10 reglas es la escala real | Un filtro extra por enumeración es irrelevante a esta escala | Consulta a producción, 2026-08-30 | Ninguna: el orden de magnitud no cambia la solución |

## Open questions

| Question | Why it matters | Recommendation and why | Tradeoffs | Owner | Blocking? | Resolution point | Bounded default |
|---|---|---|---|---|---|---|---|
| ¿Un miembro retirado de **todos** sus ministerios debe perder el acceso automáticamente? | Es el punto exacto donde los dos ejes se tocan, y colapsarlos es lo que este spec evita | **No, pero sugerirlo en la UI.** Automatizarlo reintroduce el acoplamiento que motivó separar los ejes: alguien que se va del equipo puede conservar cuenta para ver su historial | Un paso manual más para el caso más común | Frank | No | Diseño de UI en P1 | No automático; la UI ofrece el segundo paso |
| ¿Un ministry manager de kids puede retirar de kids? | D1 hizo el retiro por ministerio, pero el eje de actor sigue siendo de ROL. El CLAUDE.md dice que el rol nunca implica ministerio, y `requireMinistryManager` existe (`app/utils/authGuards.ts`) | **No en P1: super-admin-only, como todo lo demás en Miembros.** Abrirlo a ministry managers es un ensanchamiento de ACL con su propio precio de revisión, y no hay evidencia de que la operación sea frecuente | Un super-admin queda en el camino de cada retiro de kids. Si resulta molesto, se abre después como cambio propio y con su tier | Frank | No | Después de P1, si duele | Super-admin-only |
| ¿La audiencia de propuestas (`ADMIN_RECIPIENTS_QUERY`) debe filtrar retiro de worship? | Esa consulta selecciona por ROL y **no tiene filtro de ministerio alguno** hoy (`proposalNotifyQueries.ts:34`), así que componerle un filtro de worship le impone una semántica de ministerio que nunca tuvo | **Filtrar, y declarar qué pasa con un admin sólo-kids**: hoy recibe correos de propuestas de worship y este cambio se los quitaría — correcto, pero debe ser deliberado y no un efecto secundario | Si un admin gestiona worship sin servir en worship, deja de enterarse | Frank | No | Implementación de P1 | Filtrar, y anotar el cambio |

## Review handoff

- **Parent review first, then child order:** este roadmap → P1 → P2.
- **Evidence pointers:** `sanity/schemas/worshipTeam.ts:50`, `sanity/schemas/kidsPair.ts:43`,
  `sanity/schemas/sunRole.ts:51,65,93,118,129`, `app/utils/memberAccess.ts:53-77`,
  `app/ministries.ts:64-109`, `app/api/admin/members/route.ts:22-31`,
  `app/api/admin/members/[id]/route.ts:105-123`,
  `app/utils/__tests__/draftGatingCoverage.test.ts`, `app/components/admin/AdminPanel.tsx:716-830`.
- **Prior reviews, feedback, rebuttals, and planning dialogue excluded:** yes.
- **Risk tier:** **P1 crítico** y **P2 crítico** — dos `APPROVED` consecutivos sobre bytes
  idénticos cada uno.
  - P1 se clasificó primero como estándar. **Eso era un error, y se corrige derivándolo de la
    escalera, no elevándolo por precaución:** R7 crea una ruta de escritura nueva sobre
    `disabled`, el campo que `isMemberActive` lee para permitir o negar **toda** petición. La
    escalera nombra "auth/security/ACL boundary" como crítico; una ruta que escribe el gate de
    acceso está dentro, aunque el campo y su lector ya existan.
  - P2 es crítico por writer destructivo de producción.

## Terminal state

`READY_FOR_ADVERSARIAL_REVIEW` — las tres preguntas abiertas son no bloqueantes y tienen
default acotado. P1 y P2 existen como artefactos hermanos en este mismo directorio; este
roadmap define la partición, los invariantes compartidos y la cobertura, no su contenido.
