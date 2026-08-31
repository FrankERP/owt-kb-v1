# Review log — retiro de miembros (roadmap + P1 + P3 + P2)

**Estado: ROADMAP + P1 + P3 + P2 APROBADOS (loop cerrado 2026-08-31).** **La aprobación de
un plan nunca autoriza implementar.**

## Tier y por qué

| Artefacto | Tier | Derivación |
|---|---|---|
| Roadmap (padre) | Estándar | La escalera dice que los roadmaps padres son estándar salvo que posean directamente un contrato crítico. No lo posee: lo poseen los hijos. Un `APPROVED` fresco bastaría. |
| P1 | **Crítico** | R7 crea una ruta de escritura nueva sobre `disabled`, el campo que `isMemberActive` lee para permitir o negar toda petición. "auth/security/ACL boundary" está en la escalera. **Derivado de la escalera, no elevado por precaución** — y la primera versión lo clasificó como estándar, que era un error. |
| P3 | **Crítico** | Writer de `solverConfig` con serialización de array completo, borrado irreversible de reglas, y el request del solver. |
| P2 | **Crítico** | Writer destructivo de producción. |

## Rondas

| # | Digest revisado | Commit | Veredicto | Bloqueadores verificados |
|---|---|---|---|---|
| 1 | `7831292f18a20c04` | `73ac6d05` | CHANGES_REQUIRED | 2 |
| 2 | `379aa60745555ba3` | `8fd6771a` | CHANGES_REQUIRED | 3 |
| — | *consolidación* | `94d9b63c` | — | (fuente única de texto normativo) |
| 3 | `1a3429a094402efa` | `1453c1ce` | CHANGES_REQUIRED | 2 |
| 4 | `92358b87e85859a5` | *(en el mismo)* | CHANGES_REQUIRED | 3 |
| 5 | `79a1a79bf6e6fef8` | `124d94eb` | CHANGES_REQUIRED | 3 |
| — | *split a P3* | `44c86b17` | — | (autorizado por Frank) |
| 6 | `1b7071281c4e683d` | `f0d68863` | CHANGES_REQUIRED | 3 |
| 7 | `d64a43bf610588dc` | `57b09d5c` | CHANGES_REQUIRED | 2 |
| 8 | `d8a1409112247fe85c6fd8a56911ed3cdb3684a5953ffb6821ab3f71e76355c9` | `e78f90a5` (árbol actual; el digest es del roadmap, no del commit de código) | **APPROVED** | none |
| P1.1 | `6d3ec981e2dfc40c1d889218cba0d771c724f584ae1202f5638e2ba30b70b3cd` | árbol `e78f90a5` + edits de spec no commiteadas | CHANGES_REQUIRED | 1 |
| P1.2 | `a65ae40cd75ef5dcea22955550b8cb1e887bb6d3e9e0008f6e821155dc80e9f7` | mismos bytes que el snapshot de confirmación | **APPROVED** | none |
| P1.3 | `a65ae40cd75ef5dcea22955550b8cb1e887bb6d3e9e0008f6e821155dc80e9f7` | mismos bytes (confirmación) | CHANGES_REQUIRED | 1 |
| P1.4 | `4d3c232b3da9cede86011693d146f2e9aa491befe482b2e7c3dbc7c4b9465b51` | post-fix R11 (Frank go-ahead) | **APPROVED** | none |
| P1.5 | `4d3c232b3da9cede86011693d146f2e9aa491befe482b2e7c3dbc7c4b9465b51` | mismos bytes (confirmación) | **APPROVED** | none |
| P3.1 | `01fbf2e52bb8c06923f52c4ca1babb622e6defbeff604a3a1332e235fc61ff5c` | pre-adopción 8.n1 + primera ronda | CHANGES_REQUIRED | 3 |
| P3.2 | `fff597ef4f42894487f6be33b627b086e2c0b7ed34ff9a19f74f2759c4074fdc` | worship scope + dual-write | CHANGES_REQUIRED | 3 |
| P3.3 | `cf111b8683f13d101a6c58cbbdb74172253ce527aa16a4d2de88fca5af4902d3` | R10 deferral | CHANGES_REQUIRED | 3 |
| P3.4 | `8072d1d912906b0e041952ff5b97352fcd59ca8a3fa1c939e0668e803277bdd9` | outcome/deploy align | **APPROVED** | none |
| P3.5 | `8072d1d912906b0e041952ff5b97352fcd59ca8a3fa1c939e0668e803277bdd9` | mismos bytes | **APPROVED** | none |
| P2.1 | `9bfcda1e6bc7fbdfb96cc2f75a4ba87730846149aa1656f36979ff4859c4ea81` | 8.n2/8.n4 adoptados | CHANGES_REQUIRED | 2 |
| P2.2 | `d42ad3e99b93205e3828c49ea14bf64da9199e461e3a785d7ebcbaf3833a7992` | R9 guard + R9b | **APPROVED** | none |
| P2.3 | `d42ad3e99b93205e3828c49ea14bf64da9199e461e3a785d7ebcbaf3833a7992` | mismos bytes | **APPROVED** | none |

**P1 APROBADO** — digest `4d3c232b3da9cede86011693d146f2e9aa491befe482b2e7c3dbc7c4b9465b51`
(P1.4 + P1.5 consecutivos). Crítico cumplido.

P3 racha: **2 / 2 APROBADO** — digest `8072d1d912906b0e041952ff5b97352fcd59ca8a3fa1c939e0668e803277bdd9`
(P3.4 + P3.5).

P2 racha: **2 / 2 APROBADO** — digest `d42ad3e99b93205e3828c49ea14bf64da9199e461e3a785d7ebcbaf3833a7992`
(P2.2 + P2.3; P2.1 CHANGES_REQUIRED → R9 revision guard + R9b).

**Loop adversarial cerrado** — todos los hijos críticos cumplen dos `APPROVED` consecutivos.
Padre congelado en `d8a14091…`; nota P3.5: el gate P1→P3 del padre lee más estricto que P3
(R10 diferido); el padre no se edita — P3 es la fuente normativa del despliegue.

Digest aprobado del padre: `d8a1409112247fe85c6fd8a56911ed3cdb3684a5953ffb6821ab3f71e76355c9`.
El padre no se edita: cualquier edición lo dejaría fuera de esa aprobación.

## Bloqueadores, disposición y evidencia comprobada

**Todos verificados contra el código antes de aceptarse. Ninguno se aceptó por plausible.**

| # | Bloqueador | Disposición | Evidencia que comprobé |
|---|---|---|---|
| 1.1 | "Filtrar enumeración" no saca a un retirado de los pools | fixed | `plannerModel.ts:566-568` cae al id crudo; `:641-645` lo usa; `:648-661` reinyecta |
| 1.2 | `PATCH` de miembro NO es super-admin-only (afirmación falsa mía) | fixed | `route.ts:19-22` lo rechaza; `AdminPanel.tsx:566` |
| 2.1 | Colisiones de id `R8`/`R10` y tres requisitos sin fila | fixed | grep de las tres tablas |
| 2.2 | Bloqueo del último super-admin, sin nombrar | fixed → R14 | `auth.ts:52,79`; `proxy.ts:15-19` |
| 2.3 | La justificación de partición decía "P1 estándar" tras cambiarlo a crítico | fixed | lectura del propio documento |
| 3.1 | R10 exigía un estado que el solver rechaza | fixed → D7/R15 | `owt_solver_v2.py:466-467`, `:279-280`; `plannerModel.ts:648-651,686` |
| 3.2 | La columna de dependencias usada en dos sentidos | fixed | filas R3 y R8 contra la secuencia |
| 4.1 | Rollback de P1 declarado sin pérdida, con R15 borrando reglas | fixed | D7 vs la celda de rollback |
| 4.2 | `availabilityRules` es una **segunda** fuente de nombres en `dsl_rules`, sin dueño | fixed | `plannerModel.ts:666-678` vs `:653-657`; `owt_solver_v2.py:282-287,358-363` |
| 4.3 | La aceptación del padre contradecía R15 | fixed | línea 74 vs `p1:111` |
| 5.1 | R15 escribe el `solverConfig` sin guarda de revisión | fixed → R15b | `api/admin/solver-config/route.ts:37-41,125` — "It can never accept a stale `_rev`" |
| 5.2 | D8 y la pregunta abierta 3 de P1 daban instrucciones opuestas | fixed | D8 en el roadmap vs `p1:216` |
| 5.3 | R15 estrechó la condición del usuario sin declararlo | fixed | `owt_solver_v2.py:732-741` (`sum(terms) >= 1`), `:321` |

| 6.1 | La fila de P1 y Start→P1 asignaban a P1 el trabajo irreversible de P3 | fixed | tabla de hijos vs mapa |
| 6.2 | El Behavior normativo de P1 exigía filtrar los pools del request — y hacerlo en P1 solo revienta el mes | fixed | `plannerModel.ts:666-678` vs `:653-657`; `owt_solver_v2.py:287,363` |
| 6.3 | `R10` duplicado en el mapa, uno colgante, y tres referencias cruzadas a P1 por requisitos de P3 | fixed | grep de filas y referencias |
| 7.1 | Las tres lecturas de kids mal clasificadas: filtrarlas hace **daño activo** | fixed → R18/D9 | `kids/generate/route.ts:111,166`; `kidsRotation.ts:113` |
| 7.2 | La ventana P1→P3 deja varado a todo el que se retire dentro de ella, y el roadmap llamaba seguro a ese estado | fixed | R15 dispara al retirar; `owt_solver_v2.py:287` |

No refuté ningún bloqueador: los dieciocho resultaron ciertos.

## No bloqueantes adoptados

Conteo de exenciones (tres veces mal, en tres rondas distintas), deriva de números de línea,
la columna de dependencias aplicada de forma despareja, el alcance del guard limitado a `app/**`
mientras `auth.ts` queda fuera, `retiredFrom` escribible desde Studio saltándose R15, y "el
borrado falla" afirmado como hecho cuando la tabla de suposiciones lo lista como no probado.

## Fallos de proceso del autor — la mitad del registro que más vale

1. **Leí el código y no el comentario encima.** En la ronda 1 cité la reinyección de
   `extraSupport` como el defecto que R10 debía eliminar. Cuatro líneas arriba el código dice
   por qué existe: *"omitting this is a 422 in production"*. Confundí un guard con un bug y
   construí un requisito sobre esa lectura. Exactamente contra lo que advierte el CLAUDE.md.
2. **Afirmé un hecho de ACL sin comprobarlo** y derivé de él un default que ensanchaba
   permisos.
3. **Clasifiqué mal el tier de P1** como estándar, y sólo la revisión lo corrigió.
4. **Estreché la condición explícita de Frank** ("si involucra alguien más") a "si la regla
   muere", sin declararlo como desviación.
7. **Mis propios arreglos son ahora la fuente principal de defectos nuevos.** Los tres
   bloqueadores de la ronda 6 fueron residuo del split que yo acababa de hacer, y el material
   de kids que revisará la ronda 8 lo escribí en la 7. El diseño de worship, en cambio, lleva
   tres revisores consecutivos verificándolo como correcto. El loop dejó de encontrar fallos
   del diseño y encontró fallos de mi edición.
8. **Mi verificación de integridad comparaba conjuntos**, así que no podía ver una fila `R10`
   duplicada en el mapa. Lo encontró un revisor. Ahora cuenta filas, busca duplicados y resuelve
   cada referencia `Pn § Rm` contra el dueño real.
5. **La misma clase de defecto reapareció cinco rondas seguidas:** una corrección que llega a
   una sección y no a su gemela. La consolidación de la ronda 2/3 la cerró para el *texto de
   requisitos*, y volvió a aparecer en **prosa, decisiones y preguntas abiertas** — secciones
   que la regla de fuente única no cubría.
6. **El cap de churn se alcanzó en la ronda 2** y se registró antes de despachar nada más;
   Frank dio el visto bueno explícito para consolidar y reanudar. Las rondas 3-5 corren bajo
   esa autorización.

## Por qué se detuvo aquí, y no en otra ronda

Las rondas 3, 4 y 5 encontraron cada una un defecto **sustantivo y nuevo** — o sea, el loop
funcionaba. Pero los siete bloqueadores de esas tres rondas caen todos en el mismo sitio:
**R10 y R15, la interacción entre el retiro y el solve request**. El eje de retiro en sí, el
filtro, el kill switch y el endurecimiento del borrado llevan tres rondas limpios.

Eso no es un artefacto que necesite otra ronda: es un artefacto que contiene dos proyectos.
R10/R15 tocan `buildSolveRequest`, el contrato DSL del solver, un documento compartido con
guarda de revisión multi-admin, y un borrado irreversible. La recomendación registrada es
sacarlos de P1 a un hijo propio antes de volver a revisar.

## Ronda 8 — padre APPROVED (2026-08-31)

Frank eligió reanudar el loop (opción 1 del handoff). Revisor fresco
(`[Red Team](32fac888-6526-4986-895c-41a5e41a0466)`), packet frío, digest verificado
antes y después. Cero bloqueadores. Las cinco notas no bloqueantes se dispusieron
**sin editar el padre**, para no invalidar el digest aprobado:

| # | Nota | Disposición | Evidencia que comprobé |
|---|---|---|---|
| 8.n1 | El criterio de entrada P1→P3 (nadie retirado con regla sin resolver) vive sólo en el padre; la pregunta abierta de P3 habla de ids de pool y su default es "reportar, no escribir" | **adopt → P3** antes de revisar P3, no el padre | P3 open question L136 vs padre Sequence L208-216 |
| 8.n2 | Hay `reference` fuertes a `teamMembers` también en `loginEvent`, `kidsPair` y `setlistProposal`, no sólo role docs | **adopt → P2** antes de revisar P2 | `loginEvent.ts:28`; `kidsPair.ts:26`; `setlistProposal.ts:48,60,76,83,188` |
| 8.n3 | El terminal state del padre dice "P1 y P2" y omite P3 | **declined** en el padre (preservar digest); P3 existe como hermano | padre L281-283 |
| 8.n4 | Las listas "pertenece a P1" de P2 omiten R18 (y R2b) | **adopt → P2** antes de revisar P2 | P2 L46 vs mapa del padre |
| 8.n5 | `AvailabilityPanel` es otro consumidor dual de `GET /api/admin/members` | **declined** — ya está en P1 | `p1` evidence L52; `AvailabilityPanel.tsx:69` |

Ningún cambio post-aprobación al padre. Los adoptions 8.n1/8.n2/8.n4 aterrizan en los
hijos **antes** de que esos hijos se revisen, así que no quedan como material
post-aprobación de P3/P2.

## P1.1 — CHANGES_REQUIRED (2026-08-31)

Revisor fresco (`[Red Team](c93e7e46-266b-4dfd-8c92-ad7257bea364)`), packet frío, digest
`6d3ec981e2dfc40c1d889218cba0d771c724f584ae1202f5638e2ba30b70b3cd` verificado antes y
después. El eje de retiro, kids y el gate de `disabled` coincidían con el worktree.
El bloqueador de R14 se verificó **cierto** y se corrigió en P1 (el padre no se tocó).

| # | Bloqueador | Disposición | Evidencia que comprobé |
|---|---|---|---|
| P1.1.1 | R14 nombra mecanismos que no implementan su propio criterio de concurrencia: `ifRevisionId` del objetivo no serializa un predicado sobre un **conjunto** de super-admins; `transaction()` no relee GROQ | **fixed** | `publishReadyTransaction.ts:9-12` (tx = lista de mutaciones); `:26-32` (no-op `ifRevisionId` sobre docs observados es el primitivo del repo); dos writes a `_id` distintos no chocan entre sí. El remedio nombrado ahora es el quorum: la misma tx que pone `disabled: true` en el objetivo incluye no-op `ifRevisionId` sobre cada super-admin habilitado *distinto del objetivo*. El test concurrente enfrenta dos ids; un fake que sólo modele la rev del objetivo debe fallar. |

| # | Nota no bloqueante | Disposición | Evidencia |
|---|---|---|---|
| P1.1.n1 | GET members no proyecta `disabled`; `handleEdit` spread re-habilitaría | **adopt** → R4/R7: GET proyecta sin default; mutación dedicada, no el spread | `members/route.ts:23-28`; `AdminPanel.tsx:751-763` |
| P1.1.n2 | "Sesión que actúa" es el target de impersonación, no el operador real | **adopt** → R14 usa el par de `auth.ts:264-271` | `types/next-auth.d.ts:16-17,61-70`; session callback no copia `__realAdmin.sanityId` |
| P1.1.n3 | El guard GROQ no ve el filtro TypeScript de punto de uso | **adopt** → R2: test de planner / Persona / `rankCandidates` vs `memberIdToName` | el propio corte de R2 |
| P1.1.n4 | `retiredFrom` hidden en Studio era un "debería" | **adopt** → R1: `hidden` como `themePref` | `worshipTeam.ts:91-97`; `proxy.ts:15-19` |
| P1.1.n5 | AvailabilityPanel y Miembros no deben filtrar al fetch | **adopt** → inventario GET y evidencia | ya citados; reforzado |
| P1.1.n6 | Citas: `:844` y `sunRole.ts:51` | **adopt** | `serviceMutationSideEffects.ts:844`; `sunRole.ts:51` |

## P1.2 — primer APPROVED (2026-08-31)

Revisor fresco (`[Red Team](95114cb1-a6bf-4db9-8f17-11cbe203455f)`), mismo packet frío
recomputado, digest `a65ae40c…` idéntico antes y después. Cero bloqueadores. Notas no
bloqueantes verificadas y **aplazadas** para no romper la racha crítica:

| # | Nota | Disposición | Evidencia |
|---|---|---|---|
| P1.2.n1 | No doblar el predicado de retiro en `WORSHIP_AUDIENCE_GROQ_FILTER` (el de miembros se recorta de él y alimenta GET + login-events) | **adopt** en el edit post-P1.3 (la racha ya era 0) | `ministries.ts:74-77` |
| P1.2.n2 | Quorum / último SA: `disabled != true` (ausente = habilitado) | **adopt** → R14 GROQ | `memberAccess.ts:53-56`; POST members no estampa `disabled` (`members/route.ts:72-82`) |
| P1.2.n3 | R11 debe pasar por `normalizeMinistries` o un worship legacy no se puede retirar | **elevado a bloqueador en P1.3** | `ministries.ts:41-44`; R11 no lo nombraba |
| P1.2.n4 | El ValueError de Studio+P1-only es de P3; `hidden` sigue siendo correcto | **declined** como corrección de R1 — R16 ya cubre P1-sin-P3 | R16 |
| P1.2.n5 | Cita `next-auth.d.ts:16-17` es `isImpersonating`; `sanityId` es `:14` | **adopt** | `types/next-auth.d.ts:14` |
| P1.2.n6 | R6 “futuro” contra hoy en `America/Mexico_City`, no `new Date(iso)` | **adopt** → R6 | invariante CLAUDE.md; `AvailabilityPanel.tsx:77` |

## P1.3 — CHANGES_REQUIRED (2026-08-31)

Revisor fresco (`[Red Team](c19d7dea-6de2-447a-a3d5-9b8c5c3c0685)`), snapshot idéntico al
de P1.2. Cero sobre el eje de retiro / kids / R14; **R11** no ancla “pertenece” a
`normalizeMinistries` del documento almacenado. Verificado cierto:
`validateMinistryWrite` (`ministries.ts:100-109`) valida el body, no la membresía;
el precedente de membresía almacenada es `validatePairMembers` (`pairMembers.ts:17-25`).

| # | Bloqueador | Disposición | Evidencia |
|---|---|---|---|
| P1.3.1 | R11 apunta a `validateMinistryWrite`; dos wirings ingenuos fallan el caso primario (worship ausente y kids-only) | **fixed** | `ministries.ts:41-44,57-59,100-109`; `pairMembers.ts:17-25` |

| # | Nota no bloqueante | Disposición | Evidencia |
|---|---|---|---|
| P1.3.n1 | No splice en AUDIENCE | **adopt** (ya P1.2.n1) | `ministries.ts:77` |
| P1.3.n2 | R2 no nombra `MemberPool` | **adopt** → R2 | `MonthGenerator.tsx:1336-1386` |
| P1.3.n3 | `<select>` Persona con value fuera de options bajo P1-sin-P3 | **adopt** → R2 conserva valor actual | `MonthGenerator.tsx:561-564` |
| P1.3.n4 | R2b cuenta el comentario; el guard hace `stripComments` | **adopt** → cuatro exenciones ejecutables | `draftGatingCoverage.test.ts` stripComments |
| P1.3.n5 | El no-op de R14 debe ser write-back, no `set: {}`; `lastSeen` 409 falla cerrado | **adopt** → R14 | `publishReadyTransaction.ts:26-32` vs `:133-140`; `ActivityPing.tsx:7-8` |

**Cap de churn — P1.** Dos `CHANGES_REQUIRED` sustantivos en este hijo (P1.1 R14, P1.3 R11).
La clase es la misma: el spec nombra un primitivo vecino que **no implementa** el criterio
(R14 → `ifRevisionId` del objetivo; R11 → `validateMinistryWrite`). P1.4 no se despacha
sin go-ahead explícito, obtenido de antemano.

## Cambios posteriores a la última ronda — loop cerrado

El padre no se tocó. Todos los hijos tienen digest aprobado y status `APPROVED` en spec.
Edits locales sin commit en worktree `elated-chebyshev-1992d3` / branch `claude/mkz-sunday-rule-0c5298`.
