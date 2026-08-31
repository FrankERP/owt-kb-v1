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
- **Global requirements:** los requisitos NO se enuncian aquí. Viven, con su texto normativo,
  en el hijo que los posee; esta sección da la forma del problema y la tabla de cobertura da el
  mapa. En una frase: un eje nuevo de *roster*, por ministerio, aplicado en el punto de
  **selección** y jamás en el de **resolución**, que además alcanza las **referencias de roster
  ya almacenadas**. Lo normativo es **P1 § Requirements R2, R2b y R3** para el corte selección/resolución, y
  **P3 § Requirements R10** para la ausencia del solve request; lo que sigue es la evidencia de
  por qué, no una segunda redacción de ellos.

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
    de Sanity, fuera de la app. **Lo que se hace al respecto es R14, y su texto normativo está en
    P1 § Requirements** — aquí queda el peligro, no el remedio.
- **Non-goals:**
  - Migrar las reglas del solver de nombre a id. Es trabajo aparte; este spec **decide su
    diseño** (ver Decisión D4) pero no lo entrega.
  - Cambiar `unavailableDates` / `unavailabilityNotes`. La indisponibilidad es un eje distinto
    y ya existente: temporal, por fechas, declarada por el propio miembro. El retiro es
    indefinido, sin fechas y administrativo.
  - Cualquier cambio al solver (`gcf/owt_solver_v2.py`).
  - Retirar parejas de kids (`kidsPair.active` ya existe y no se toca).
- **Integration acceptance:** con P1, P3 y P2 entregados, un super-admin puede (a) retirar a un
  miembro de worship desde la app y verlo desaparecer del dropdown de reglas, del ranking de
  candidatos y de las audiencias de correo de worship, **y —una vez entregado P3— dejar de ser asignable por el solver**,
  con las reglas que lo nombraban ya resueltas según los tres casos que **P3 § R15** define
  como normativos — esta frase no los reenumera a propósito: una versión anterior los resumió
  como un binario "borradas o confirmadas", que no tiene lugar para el caso en que la regla se
  **edita y sobrevive**, y quedó contradiciendo al hijo. Conservándolo en kids si aplica; (b) verlo seguir
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
| Las cinco sedes de role docs son `reference` a `teamMembers`, sin `weak: true` | `sanity/schemas/sunRole.ts:50,65,93,117,128` | Sanity ya bloquea borrar a quien haya servido. El borrado duro no es una vía de salida real hoy. |
| `DELETE` hace `await writeClient.delete(id)` sin try/catch | `app/api/admin/members/[id]/route.ts:119` | Un borrado rechazado por integridad sale como 500 y la UI dice sólo "Error al eliminar". |
| Los pools del `solverConfig` (`sundayLeads`/`saturdayLeads`/`support`) guardan ids como strings planos | consulta a producción, 2026-08-30 | Sin integridad referencial: un borrado deja ids colgando ahí. Bug latente preexistente, en P2. |
| `kidsPair.active`: "Las parejas retiradas conservan su historial pero salen de todas las rotaciones" | `sanity/schemas/kidsPair.ts:43-48` | Precedente del patrón EN ESTE REPO, con la semántica exacta que se busca. |
| `validateMinistryWrite` rechaza `ministries` vacío | `app/ministries.ts:107` | El campo nuevo debe poder expresar "retirado de todo" sin recurrir a vaciar `ministries`. |
| `buildSolveRequest` mapea ids de pool con `memberIdToName`, que cae al **id crudo** si el miembro no está en la lista; `resolvedNameOrRaw` reinyecta a todo nombrado-por-regla ausente de los pools en `extraSupport` | `app/components/admin/plannerModel.ts:554-557, 566-568, 641-645, 648-661` | Filtrar la lista de miembros NO saca a un retirado del solve request: su id se vuelve una persona asignable. Origen de R10. **Cuidado: la reinyección en `extraSupport` NO es un defecto, es un guard** — ver la fila siguiente. |
| `unresolvedRuleNames` sólo inspecciona nombres de reglas, nunca ids de pool | `app/components/admin/ruleEnforcement.ts:225-249` | El fallo del id crudo sería silencioso: ningún reporte existente lo vería. |
| **El solver RECHAZA cualquier persona nombrada en `dsl_rules` que no esté en los pools**: `known = set(all_people)` (los tres pools) y `require_person` lanza `ValueError` | `gcf/owt_solver_v2.py:466-467`, `:279-280` | La reinyección en `extraSupport` (`plannerModel.ts:653-662`) es el **guard** que evita ese 422, y su comentario lo dice en `:648-651`. Una versión anterior de este roadmap la citó como defecto: era una lectura equivocada del código, y R10 derivado de ella exigía un estado que el solver rechaza. |
| `dsl_rules` se emite sin filtro de pertenencia a pool: `allRulesToDs` no filtra nada y su salida entra directo al request | `app/components/admin/plannerModel.ts:585-597`, `:686` | Sacar a un retirado de todos los pools mientras una regla lo nombra **rompe el solve del mes entero**, no sólo su asignación. |
| Ya existe precedente de reglas DSL **autogeneradas** para acotar a un miembro que sí está en un pool: `availabilityRules` emite `<nombre> !in week N Sun.*` desde `unavailableDates` | `app/components/admin/plannerModel.ts:666-678` | Es el mecanismo que hace viable la opción (v) de la decisión pendiente D7. |
| `PATCH /api/admin/members/[id]` es **super-admin-only**, igual que `DELETE`; la pestaña Miembros es `roles: ["super-admin"]` | `app/api/admin/members/[id]/route.ts:19-22`; `app/components/admin/AdminPanel.tsx:567` | Corrige una afirmación falsa de la primera versión. Retirar con rol `admin` no sería alineación sino ensanchamiento de ACL. |
| `ADMIN_RECIPIENTS_QUERY` no tiene filtro de ministerio alguno | `app/utils/proposalNotifyQueries.ts:34` | Componerle un filtro de retiro *de worship* exige decidir antes qué significa para un admin sólo-kids. |
| `draftGatingCoverage.test.ts` es un escaneo invertido de `app/**` que exime por excepción | `app/utils/__tests__/draftGatingCoverage.test.ts` | Mecanismo ya probado para invariantes de filtro. El retiro necesita el suyo, o repite la historia: "una frase en CLAUDE.md y N call sites correctos, que es un estado, no un mecanismo". |
| La regla `5cbxwcm` del `solverConfig` nombra a `"Vale Sosa"`, que no resuelve a nadie | consulta a producción, 2026-08-30 | Caso real que motiva D4. No lo arregla este spec. |

## Decomposition rationale

**Son TRES hijos, y el tercero se separó por evidencia, no por diseño previo.** P3 nació dentro
de P1 y salió tras cinco rondas de revisión adversarial cuyos siete bloqueadores sustantivos
cayeron **todos** en la misma interacción —el retiro contra el solve request— mientras el eje de
retiro, el filtro y el kill switch estuvieron limpios tres rondas seguidas. Esa concentración es
el dato: no era un requisito más de P1, era un segundo proyecto escondido entre diez requisitos
tranquilos. P3 toca `buildSolveRequest`, el contrato DSL del solver, un documento compartido con
guarda de revisión multi-admin y un borrado que no se deshace. Separarlo devuelve a P1 su
naturaleza aditiva y le da a P3 el presupuesto de revisión que su historial demuestra que
necesita.

**P1, P3 y P2 se separan también por dependencia y despliegue independiente.** P1 es útil y desplegable
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

**P3 y P2 dependen de P1**, y no al revés. P3 necesita que `retiredFrom` exista para tener a
quién excluir; el mensaje de error de P2 ofrece "retirar en su lugar". P1 es desplegable y útil
sin ninguno de los dos — **pero incompleto de una forma que un administrador no puede ver**, y
por eso R16 existe: sin P3, retirar saca a alguien de la selección y **no** del solver, y la UI
tiene que decirlo. Un estado intermedio que engaña es peor que uno que falta.

## Child plans

| ID | Artifact type | Outcome and acceptance contract | Prerequisites | Outputs | Safe ending state | Rollback or recovery | Review order |
|---|---|---|---|---|---|---|---|
| P1 | Spec | Eje de retiro por ministerio: esquema, filtro en el punto de selección, guard de cobertura, UI con los dos ejes separados, aviso en el planner y la copia honesta de R16. Aceptado cuando un retirado sale de la selección de ese ministerio, sigue resolviendo en el historial, `disabled` conserva su comportamiento medido, y la UI **no afirma** que retirar lo saque del solver — porque sin P3 no lo saca. | Ninguno | Campo persistido; predicado de filtro compartido; test de cobertura; UI con los dos ejes; copia y aviso de R16 | Desplegable solo. Sin ningún miembro retirado, el sistema se comporta idéntico a hoy. | Totalmente reversible: el campo es aditivo, revertir el código deja documentos con un campo que nadie lee, y no se pierde nada. **La parte irreversible se fue a P3**, que es donde vive el borrado de reglas. | 1 |
| P3 | Spec | Sacar al retirado del solve request: ausencia total del request, resolución de reglas con confirmación, guarda de revisión sobre el `solverConfig`. Aceptado cuando el nombre y el id de un retirado no aparecen en ninguna parte del request, un mes sin retirados produce un request byte-idéntico al de hoy, y ninguna regla que nombre a otra persona se tocó sin que el operador la viera. | P1 | Exclusión en `buildSolveRequest`; borrado de reglas revision-guarded; aviso de retirados en pools | Desplegable solo una vez P1 está. | **Borra reglas del `solverConfig` de forma irreversible.** Revertir el código no las devuelve; la recuperación es un export previo del dataset, o ninguna, y el plan de implementación debe elegir cuál. | 2 |
| P2 | Spec | Borrado duro que falla legible y limpia lo que Sanity no protege. Aceptado cuando borrar a alguien con historial explica por qué y ofrece retirar, y borrar a alguien sin historial no deja ids colgando en `solverConfig`. | P1 | `DELETE` endurecido; limpieza de pools | Desplegable solo una vez P1 está. | Writer destructivo: el plan de implementación debe definir su propia recuperación. | 3 |

## Requirement-to-plan coverage

**Regla de fuente única — léela antes de editar cualquiera de los tres artefactos.**
El **texto normativo de cada requisito vive exactamente una vez, en el hijo que lo posee**.
Esta tabla es un MAPA, no una copia: la columna "Nombre" es una etiqueta estable que identifica
al requisito, deliberadamente **no** un resumen de su contenido, para que refinar el texto de un
requisito no obligue a editar aquí y no pueda quedar desincronizado.

Esta regla existe por evidencia, no por gusto. Las dos primeras rondas de revisión adversarial
de este roadmap encontraron **la misma clase de defecto**: una corrección que llegó a una
sección y no a su gemela — el tier arreglado en un lado y la justificación contradiciéndolo en
otro, `R10` añadido a dos artefactos sin reconciliar con el `R10` que ya existía en el tercero,
"las tres exenciones" escrito mientras el inventario del mismo spec listaba cuatro. La causa era
que cada requisito estaba escrito en tres o cuatro lugares. **Si vuelves a pegar texto de
requisito aquí, reintroduces la clase entera.**

Los identificadores son únicos en toda la familia: no hay dos `R10`.

**Dirección de la columna "Planes que dependen":** lista los planes que **dependen de este
requisito**, nunca los planes de los que el requisito depende. Se llena **sólo** cuando otro plan no puede
cumplir su propio contrato sin este requisito; una dependencia meramente de secuencia entre
planes vive en la tabla de planes hijos y en la de secuencia, no aquí, para que la columna no
duplique lo que esas ya dicen. La dirección se escribe porque
una versión anterior la usó con los dos sentidos en dos filas distintas, y la fila equivocada
implicaba retener el despliegue de P1 hasta P2 — al revés de la secuencia que este mismo
documento fija.

| ID | Nombre (etiqueta estable) | Texto normativo vive en | Plan dueño | Planes que dependen | Dueño de verificación |
|---|---|---|---|---|---|
| R1 | Almacenamiento del retiro | P1 § Requirements | P1 | — | P1 |
| R2 | Filtro de selección | P1 § Requirements | P1 | — | P1 |
| R2b | Exenciones declaradas | P1 § Requirements | P1 | — | P1 |
| R3 | Resolución nunca filtra | P1 § Requirements | P1 | — | P1 |
| R4 | `disabled` intacto | P1 § Requirements | P1 | — | P1 |
| R5 | Servicios publicados no se tocan | P1 § Requirements | P1 | — | P1 |
| R6 | Aviso de ocupante retirado | P1 § Requirements | P1 | — | P1 |
| R7 | Kill switch en la app | P1 § Requirements | P1 | — | P1 |
| R11 | Boundary de escritura del retiro | P1 § Requirements | P1 | — | P1 |
| R14 | Anti-bloqueo del kill switch | P1 § Requirements | P1 | — | P1 |
| R16 | Honestidad del estado intermedio | P1 § Requirements | P1 | — | P1 |
| R10 | Ausencia total del solve request | P3 § Requirements | P3 | — | P3 |
| R15 | Resolución de reglas al retirar | P3 § Requirements | P3 | — | P3 |
| R15b | Guarda de revisión del `solverConfig` | P3 § Requirements | P3 | — | P3 |
| R17 | Orden entre resolver reglas y excluir | P3 § Requirements | P3 | — | P3 |
| R8 | Borrado que falla legible | P2 § Requirements | P2 | — | P2 |
| R9 | Borrado sin ids colgantes | P2 § Requirements | P2 | — | P2 |
| R12 | Borrado sin divergencia (concurrencia) | P2 § Requirements | P2 | — | P2 |
| R13 | ACL del borrado preservada | P2 § Requirements | P2 | — | P2 |

Ningún requisito queda sin dueño y ninguno tiene dos. Las relaciones que un lector podría
confundir se declaran donde viven, no aquí: **R9 (P2) no es R10 (P3)** — gobiernan los mismos tres arrays de
`solverConfig` con intención opuesta: R9 borra el id porque el documento ya no existe, R10 lo
conserva porque el retiro es reversible, y **R14 acota a R7**.

## Sequence and safe states

| Transition | Entry criteria | Allowed release state | Exit criteria | Recovery if interrupted |
|---|---|---|---|---|
| Start → P1 | Spec P1 aceptado | Desplegable a producción | Un miembro retirado sale de la selección de ese ministerio, sigue resolviendo en el historial, `disabled` sin cambio observable, y la UI **declara** que el retiro todavía no lo saca del solver (R16) | Revertir el código deja el campo huérfano y sin lectores. Nada se pierde: el borrado irreversible de reglas es de P3, no de aquí. |
| P1 → P3 | P1 en producción y verificado | Desplegable a producción | El nombre y el id de un retirado no aparecen en el solve request; un mes sin retirados produce un request byte-idéntico | Escritura irreversible de reglas: lo define el plan de implementación de P3. Un `solverConfig` escrito sin el `retiredFrom` es recuperable; el inverso deja el estado de P1-sin-P3, que R16 hace seguro. |
| P3 → P2 | P3 en producción y verificado | Desplegable a producción | Borrado con historial falla legible; sin historial, limpio | Writer destructivo: lo define el plan de implementación de P2. |

## Shared decisions

| Decision | Choice | Why | Tradeoffs | Owner |
|---|---|---|---|---|
| D1 Alcance del retiro | **Por ministerio** | Elección del usuario. Cubre "salió de alabanza pero sigue en kids" sin vaciar `ministries`, que el boundary de escritura rechaza. | **Recomendé global y el usuario eligió por ministerio.** El costo es real y queda registrado: un tercer eje que cruzar con `ministries` y `disabled`, el filtro y su guard duplicados en las dos mitades, y más superficie de UI. Se acepta a cambio de no forzar el caso mixto a través de `ministries`. | Frank |
| D2 Asignaciones futuras al retirar | No se tocan; se señalan | El retiro es un hecho del roster, no una edición del calendario. Vaciar sedes reescribiría servicios que el equipo ya vio y podría disparar correos de cambio de rol. | Queda trabajo manual por servicio. Se mitiga con R6. | Frank |
| D8 Audiencias seleccionadas por ROL | Exentas del filtro de retiro, todas, sin excepción | Resuelve con UNA regla dos casos que tenían defaults opuestos: `outboxLiveness` (alarma de outbox atorado a super-admins) estaba exento por ser "audiencia de operador", y `ADMIN_RECIPIENTS_QUERY` (propuestas a managers) iba a filtrar — misma forma exacta, `role in [...]`, sin filtro de ministerio. La regla es la que ya rige todo este spec: **el retiro habla de SERVIR, no de gestionar.** Un admin que dejó de servir sigue gestionando, y si además dejó de gestionar, lo que cambia es su rol, no su retiro. | Un admin retirado que además dejó de gestionar sigue recibiendo correos de propuestas hasta que le cambien el rol. Es un paso más, en el eje correcto. | P1 |
| D7 Reglas que nombran a un retirado | Se **borran** al retirar; con **confirmación** cuando la regla involucra a alguien más | Elección de Frank, tras descubrirse que sacar a un retirado de los pools mientras `dsl_rules` lo nombra lanza un `ValueError` en el solver y rompe el mes entero. Borrar la regla individual es limpio; tocar una **conjunta** le cambia la programación a alguien que no se retiró, y por eso se enseña antes en vez de hacerse solo. **El corte es "¿nombra a alguien más?", no "¿la regla muere?"**: una presencia de tres personas se edita y sobrevive, y aun así aprieta la restricción sobre los que quedan, así que también se confirma. **Los casos exactos son normativos en P3 § R15 y no se reenumeran aquí** — son tres, no dos, porque una regla de presencia con tres o más personas se edita y sobrevive en vez de morir. Rechaza la alternativa de omitir esas reglas del request, que sería normalización silenciosa — la clase de cosa por la que `"Vale Sosa"` sobrevivió invisible. | **El borrado de reglas no se deshace al des-retirar**: el retiro es reversible, sus reglas no. Asimetría deliberada, que la UI debe declarar antes de confirmar. | Frank |
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

## Review handoff

- **Parent review first, then child order:** este roadmap → P1 → P3 → P2.
- **Evidence pointers:** `sanity/schemas/worshipTeam.ts:50`, `sanity/schemas/kidsPair.ts:43`,
  `sanity/schemas/sunRole.ts:50,65,93,117,128`, `app/utils/memberAccess.ts:53-77`,
  `app/ministries.ts:64-109`, `app/api/admin/members/route.ts:22-31`,
  `app/api/admin/members/[id]/route.ts:105-123`,
  `app/utils/__tests__/draftGatingCoverage.test.ts`, `app/components/admin/AdminPanel.tsx:716-830`.
- **Prior reviews, feedback, rebuttals, and planning dialogue excluded:** yes.
- **Nota de consolidación:** tras dos rondas cuyos hallazgos fueron todos de la misma clase —
  una corrección que llegó a una sección y no a su gemela — los tres artefactos se consolidaron
  para que cada requisito tenga un solo lugar donde su texto puede cambiar. Esa consolidación
  **no está revisada**: es material nuevo posterior a la ronda 2.
- **Risk tier:** **P1, P3 y P2 críticos** — dos `APPROVED` consecutivos sobre bytes
  idénticos cada uno.
  - P1 se clasificó primero como estándar. **Eso era un error, y se corrige derivándolo de la
    escalera, no elevándolo por precaución:** R7 crea una ruta de escritura nueva sobre
    `disabled`, el campo que `isMemberActive` lee para permitir o negar **toda** petición. La
    escalera nombra "auth/security/ACL boundary" como crítico; una ruta que escribe el gate de
    acceso está dentro, aunque el campo y su lector ya existan.
  - P3 es crítico: escribe un documento compartido de producción con serialización de array
    completo, borra reglas de forma irreversible y cambia el request que alimenta al solver.
  - P2 es crítico por writer destructivo de producción.

## Terminal state

`READY_FOR_ADVERSARIAL_REVIEW` — las tres preguntas abiertas son no bloqueantes y tienen
default acotado. P1 y P2 existen como artefactos hermanos en este mismo directorio; este
roadmap define la partición, los invariantes compartidos y la cobertura, no su contenido.
