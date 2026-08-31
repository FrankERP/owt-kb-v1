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
  una sola de 23 consultas: la caché de auth). Borrar el documento sí lo saca de todo, pero
  destruye la identidad que el historial referencia — y de hecho falla, porque los role docs
  usan referencias fuertes. El resultado práctico es que un miembro que ya no sirve se queda
  en los pools del planner, en el dropdown de reglas del solver y en las audiencias de correo,
  indefinidamente.
- **Global requirements:** ver la tabla de cobertura. En una frase: un eje nuevo de *roster*,
  por ministerio, que filtra las lecturas de **enumeración** y jamás las de **resolución**.
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
- **Non-goals:**
  - Migrar las reglas del solver de nombre a id. Es trabajo aparte; este spec **decide su
    diseño** (ver Decisión D4) pero no lo entrega.
  - Cambiar `unavailableDates` / `unavailabilityNotes`. La indisponibilidad es un eje distinto
    y ya existente: temporal, por fechas, declarada por el propio miembro. El retiro es
    indefinido, sin fechas y administrativo.
  - Cualquier cambio al solver (`gcf/owt_solver_v2.py`).
  - Retirar parejas de kids (`kidsPair.active` ya existe y no se toca).
- **Integration acceptance:** con P1 y P2 entregados, un super-admin puede (a) retirar a un
  miembro de worship desde la app y verlo desaparecer de los pools, del dropdown de reglas y
  de las audiencias de correo de worship, conservándolo en kids si aplica; (b) verlo seguir
  apareciendo, con su nombre, en todo servicio pasado donde sirvió; (c) revocarle el acceso
  desde la misma pantalla con un control visiblemente distinto; y (d) recibir un error legible
  —con la opción de retirar— al intentar borrar a alguien con historial.

## Evidence

| Fact | Source | Planning implication |
|---|---|---|
| `disabled` existe, `initialValue: false`, descrito como "kill switch. Reversible" | `sanity/schemas/worshipTeam.ts:50-54` | No hay que inventar el eje de acceso: ya está, y hay que dejarlo intacto. |
| `isMemberActive` = doc existe && `disabled !== true`, caché TTL 30 s | `app/utils/memberAccess.ts:56,75` | El "rápido" que pidió el usuario ya está medido: 30 s. El retiro no debe entrar a esta ruta. |
| De 23 lecturas de `teamMembers` en `app/**`, **1** menciona `disabled` — la de auth | `grep` sobre `app/**` | `disabled` hoy NO saca a nadie de ningún roster. Es la razón por la que "deshabilitar en vez de borrar" no funciona todavía. |
| Las lecturas se parten en enumeración (`*[_type == "teamMembers" && <filtro>]`) y resolución (`_id in $ids` / `_id == $id`) | Inventario en P1 | Es la regla del spec: filtrar enumeración, nunca resolución. Filtrar una resolución rompería el historial y los correos de gente ya asignada. |
| Las cinco sedes de role docs son `reference` a `teamMembers`, sin `weak: true` | `sanity/schemas/sunRole.ts:51,65,93,118,129` | Sanity ya bloquea borrar a quien haya servido. El borrado duro no es una vía de salida real hoy. |
| `DELETE` hace `await writeClient.delete(id)` sin try/catch | `app/api/admin/members/[id]/route.ts:119` | Un borrado rechazado por integridad sale como 500 y la UI dice sólo "Error al eliminar". |
| Los pools del `solverConfig` (`sundayLeads`/`saturdayLeads`/`support`) guardan ids como strings planos | consulta a producción, 2026-08-30 | Sin integridad referencial: un borrado deja ids colgando ahí. Bug latente preexistente, en P2. |
| `kidsPair.active`: "Las parejas retiradas conservan su historial pero salen de todas las rotaciones" | `sanity/schemas/kidsPair.ts:43-48` | Precedente del patrón EN ESTE REPO, con la semántica exacta que se busca. |
| `validateMinistryWrite` rechaza `ministries` vacío | `app/ministries.ts:107` | El campo nuevo debe poder expresar "retirado de todo" sin recurrir a vaciar `ministries`. |
| `draftGatingCoverage.test.ts` es un escaneo invertido de `app/**` que exime por excepción | `app/utils/__tests__/draftGatingCoverage.test.ts` | Mecanismo ya probado para invariantes de filtro. El retiro necesita el suyo, o repite la historia: "una frase en CLAUDE.md y N call sites correctos, que es un estado, no un mecanismo". |
| La regla `5cbxwcm` del `solverConfig` nombra a `"Vale Sosa"`, que no resuelve a nadie | consulta a producción, 2026-08-30 | Caso real que motiva D4. No lo arregla este spec. |

## Decomposition rationale

**P1 y P2 se separan por nivel de riesgo, no por tamaño.** P2 toca un *writer destructivo de
producción* (`DELETE` de un documento raíz). Según el CLAUDE.md eso es contrato crítico y exige
dos `APPROVED` consecutivos sobre bytes idénticos. P1 es aditivo: un campo nuevo, filtros de
lectura y UI — riesgo estándar. Fusionarlos arrastraría todo P1 al nivel crítico y le cobraría
a la parte segura el costo de revisión de la peligrosa. Cada uno tiene su contrato de
aceptación, se verifica de forma independiente y tiene un estado final desplegable por sí solo.

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
| R2 | Las lecturas de enumeración filtran a los retirados de ese ministerio | P1 | — | P1 | Guard de cobertura, no revisión manual. |
| R3 | Las lecturas de resolución (`_id in $ids` / `_id == $id`) NUNCA filtran | P1 | P2 | P1 | El guard debe distinguir las dos formas, no sólo exigir el filtro. |
| R4 | `disabled` conserva significado, latencia y lectores exactos | P1 | — | P1 | Verificación negativa: ninguna ruta nueva lo lee ni lo escribe junto al retiro. |
| R5 | Retirar no modifica ningún servicio ya publicado | P1 | — | P1 | Decisión D2. |
| R6 | Un ocupante retirado en un servicio futuro se señala en el planner | P1 | — | P1 | Es la contraparte de R5: no tocar exige avisar. |
| R7 | El kill switch es operable desde la app, visiblemente distinto del retiro | P1 | — | P1 | Ver rationale de descomposición. |
| R8 | Borrar a quien tiene historial falla con una razón legible y ofrece retirar | P2 | P1 | P2 | Depende de que el retiro exista. |
| R9 | Borrar no deja ids colgando en los pools del `solverConfig` | P2 | — | P2 | Bug preexistente, independiente del retiro. |

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
| ¿Quién puede retirar: super-admin o también admin? | `DELETE` es super-admin-only; `PATCH` de miembro no lo es | **Admin.** El retiro es reversible y no destructivo, a diferencia del borrado; restringirlo a super-admin haría que se use el borrado en su lugar | Más gente puede sacar a alguien de las rotaciones | Frank | No | P1 | Admin, alineado con el `PATCH` existente |

## Review handoff

- **Parent review first, then child order:** este roadmap → P1 → P2.
- **Evidence pointers:** `sanity/schemas/worshipTeam.ts:50`, `sanity/schemas/kidsPair.ts:43`,
  `sanity/schemas/sunRole.ts:51,65,93,118,129`, `app/utils/memberAccess.ts:53-77`,
  `app/ministries.ts:64-109`, `app/api/admin/members/route.ts:22-31`,
  `app/api/admin/members/[id]/route.ts:105-123`,
  `app/utils/__tests__/draftGatingCoverage.test.ts`, `app/components/admin/AdminPanel.tsx:716-830`.
- **Prior reviews, feedback, rebuttals, and planning dialogue excluded:** yes.
- **Risk tier:** P1 estándar. **P2 crítico** (writer destructivo de producción) — dos `APPROVED`
  consecutivos sobre bytes idénticos, según el CLAUDE.md.

## Terminal state

`NEEDS_USER_DECISION` — las dos preguntas abiertas son no bloqueantes y tienen default acotado,
pero **P1 y P2 aún no existen como artefactos**. Este roadmap sólo define la partición.
