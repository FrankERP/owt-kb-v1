# Spec: sacar al retirado del solve request (P3)

## Status

`APPROVED` — hijo 2 de 3 de `2026-08-30-member-retirement-roadmap.md`.
Digest aprobado: `8072d1d912906b0e041952ff5b97352fcd59ca8a3fa1c939e0668e803277bdd9`
(P3.4 + P3.5, 2026-08-31). **La aprobación de un plan nunca autoriza implementar.**

**Por qué existe como hijo separado.** Nació dentro de P1 y salió tras cinco rondas de revisión
adversarial cuyos siete bloqueadores sustantivos cayeron **todos aquí**, mientras el resto de P1
—el eje de retiro, el filtro de selección, el kill switch— estuvo limpio tres rondas seguidas.
No es un requisito más de P1: toca `buildSolveRequest`, el contrato DSL del solver, un documento
compartido con guarda de revisión multi-admin y un borrado que no se deshace. Mantenerlo dentro
le cobraba a la parte aditiva el precio de revisión de la peligrosa y, peor, escondía la
peligrosa entre diez requisitos tranquilos.

## Original request

> Cómo manejaríamos lo del reference si quiero eliminar un miembro?
> Podríamos "deshabilitar" a los miembros en vez de borrarlos para mantener los datos históricos también?
>
> sí, levanta el spec del retiro suave
> Quiero conservar una forma de revocar el acceso de forma "rápida"

Y, sobre el retirado que además tiene una regla del solver:

> Borrar la regla de una persona retirada.
> Si es una regla conjunta (si involucra alguien más, se pide revisión de la regla antes de
> eliminar a la persona o se pregunta confirmación de forzar el borrado de la regla)

## Outcome

- **Primary outcome:** un miembro retirado **de worship** deja de ser asignable por el solver en
  estado **R10 plena** (sin reglas vivas que lo nombren, o tras R15), sin romper el solve y sin
  que se borre a espaldas de nadie una regla que protege a otra persona.
- **Intended user or operator:** super-admin retirando a alguien desde la pestaña Miembros.
- **Problem and current behavior:** con P1 entregado, un retirado de worship sale de la
  **selección** pero **sigue en los pools almacenados** del `solverConfig` y por tanto en el
  **solve request**. El solver lo trata como candidato normal. Un retiro sólo de kids (P1 R18) no
  entra aquí.
- **Success measure:** bajo **R10 plena**, el nombre y el id del retirado de worship no aparecen
  en ninguna parte del request; el solve del mes corre igual que antes. Durante **R10 diferido**
  (regla vigente que lo nombra), el retirado **sigue** en el request por diseño hasta R15. Ninguna
  regla que nombre a otra persona se borró ni se editó sin que el operador la viera primero.

## Evidence

| Fact | Source | Planning implication |
|---|---|---|
| `memberIdToName` cae al **id crudo** cuando el miembro no está en la lista | `app/components/admin/plannerModel.ts:566-568`, usado en `:641-645` | Filtrar la lista de miembros no saca a nadie del request: lo convierte en una "persona" llamada `gJgJ2wc44ylNYNyNTYYu5k`, asignable. |
| `unresolvedRuleNames` sólo inspecciona nombres de reglas, nunca ids de pool | `app/components/admin/ruleEnforcement.ts:225-249` | Ese fallo sería **silencioso**: ningún reporte existente lo vería. |
| El solver arma `known` **sólo con los tres pools** y rechaza cualquier persona nombrada en `dsl_rules` que no esté ahí | `gcf/owt_solver_v2.py:466-467`, `:279-280`, `:282-287` | Sacar al retirado de los pools mientras una regla lo nombra **rompe el solve del mes entero**, no sólo su asignación. |
| La reinyección en `extraSupport` es el **guard** que evita ese 422, y el comentario lo dice | `app/components/admin/plannerModel.ts:648-651`, `:653-662` | **No es un defecto.** Una versión anterior de este trabajo la citó como tal y derivó de ahí un requisito imposible. |
| `dsl_rules` tiene **DOS** fuentes: `allRulesToDs` y `availabilityRules`, y la segunda recorre los pools **crudos** de `config` sin pasar por el guard | `plannerModel.ts:585-597`, `:666-678` vs `:653-657`, ambas consumidas en `:686` | Un retirado con `unavailableDates` queda nombrado en `dsl_rules` y ausente de `known`. Por eso el criterio se enuncia sobre el **request completo** y no sobre los pools. |
| Las cláusulas de exclusión semanal pasan por `resolve_person`, que lanza | `gcf/owt_solver_v2.py:358-363`, `:282-287` | Cierra la puerta anterior: no hay tolerancia a nombres desconocidos en ninguna rama. |
| `any_of()` con menos de dos nombres **lanza** | `gcf/owt_solver_v2.py:321` | Es lo que hace que el corte 2-vs-3 personas en una regla de presencia sea técnico, no arbitrario. |
| `any_of` compila a `sum(terms) >= 1` sobre las personas nombradas | `gcf/owt_solver_v2.py:732-741` | Quitar a uno de una presencia de tres **obliga a los otros dos** a cubrir semanas que antes no les tocaban. Por eso editar también se confirma. |
| El writer existente del `solverConfig` exige un `rev` observado por el cliente, commitea con `ifRevisionId` y rechaza `stale_revision` — "multi-admin is the entire point" | `app/api/admin/solver-config/route.ts:37-41`, `:106`, `:125` | Cualquier otra escritura a ese documento debe llevar la misma guarda o pisa el set de reglas completo de otro admin. |
| Los pools de `solverConfig` son arrays de string plano, sin integridad referencial | `sanity/schemas/solverConfig.ts:68-79` | Nada impide que un id apunte a un documento inexistente; los pools no se pueden usar como fuente de verdad de existencia. |
| El body de un 422 del solver llega al cliente y se muestra | `app/api/admin/solve/route.ts:60-63`, `MonthGenerator.tsx:2799` | El modo de fallo es **ruidoso**, no silencioso. Importa para la evaluación de riesgo del estado parcial. |
| Taxonomía de reglas: `restriction` nombra a una persona, `conflict` exactamente dos, `presence` n | `sanity/schemas/solverConfig.ts:88`, `:137-160` | Es la base del corte "¿nombra a alguien más?". |
| El historial de equidad filtra por `valid = set(all_people)` e ignora nombres desconocidos | `gcf/owt_solver_v2.py:483`, `:499-506` | Puerta cerrada: sacar al retirado de los pools **no** rompe el mes por la vía del `history`. Verificado explícitamente. |

## Requirements

**Este spec es la fuente única del texto normativo de los requisitos que posee.** El roadmap
padre los mapea por id y etiqueta estable, y no copia este texto. `R1`–`R7`, `R11`, `R14` y `R16`
pertenecen a P1; `R8`, `R9`, `R12` y `R13` a P2. Los ids son únicos en toda la familia.

| ID | Requirement | Rationale | Acceptance criterion |
|---|---|---|---|
| R10 | Para cada miembro retirado de worship (`defined(retiredFrom) && "worship" in retiredFrom`): **si ninguna regla vigente de `solverConfig` lo nombra** (mismo criterio de nombre que `resolveToMemberName` / `dn()` en `plannerModel.ts:536-541`, `MonthGenerator.tsx:76`), su nombre e id **no aparecen en ninguna parte del solve request** — ni en un pool, ni en `dsl_rules` (ambas fuentes, incluidas cláusulas autogeneradas desde `unavailableDates` que recorren pools crudos sin pasar por `extraSupport`), ni en la reinyección de `extraSupport` (`plannerModel.ts:652-661`). **Si una regla vigente lo nombra**, R10 **difiere la exclusión**: el request se construye como hoy, con el retirado presente, hasta que R15 resuelve esa regla. El diferimiento es lo que hace seguro el orden dual-write (miembro antes que `solverConfig`) y el legado P1→P3. Quien sólo está retirado de kids (`retiredFrom: ["kids"]` sin `"worship"`) **sigue** en el request sin evaluar R10 | Enunciarlo sobre los pools no basta; sin predicado de ministerio, worship-activo + kids-retired desaparecería del mes. Exclusión unconditional con escritura miembro-primero reproduce el `ValueError` del mes entero mientras las reglas siguen vivas | Seis tests de `buildSolveRequest`: (a) retirado de worship en pool, sin reglas → excluido; (b) retirado de worship con `unavailableDates` en domingo y sábado previo, sin reglas → sin cláusulas con su nombre; (c) mes sin retirados de worship → request **byte-idéntico** al de hoy; (d) `retiredFrom: ["kids"]` y activo en worship → **sigue** en pools y `dsl_rules`; (e) retirado de worship **con** regla que lo nombra → **sigue** en el request (diferimiento); (f) tras R15 resuelve la regla → excluido |
| R15 | Al **retirar de worship**, se resuelven las reglas que nombran al retirado. El retiro de kids (P1 R18, registro sin cambio operativo) **no** toca `solverConfig` ni dispara confirmaciones de R15. El corte es **"¿nombra a alguien más?"**, no "¿la regla muere?": si nombra sólo al retirado se borra sin preguntar; si nombra a alguien más se enseña qué le pasa y **a quién afecta**, y no procede sin confirmación explícita — tanto si muere (conflicto, o presencia de exactamente dos) como si **se edita y sobrevive** (presencia de tres o más). Tras R15, R10 deja de diferir para ese miembro | Es la condición que puso Frank, literal. Editar no es inocuo: `any_of` compila a `sum(terms) >= 1`. Sin carve-out R18, retiro kids borraría reglas de worship irreversiblemente | Un test por caso de worship; test sin confirmación **no escribe** miembro ni `solverConfig`; presencia de tres exige confirmación; retiro kids no escribe `solverConfig`; tras R15, test (f) de R10 |
| R15b | La escritura de R15 al `solverConfig` va **revision-guarded** y falla cerrada ante un `rev` viejo | El writer existente ya trata esto como riesgo de primera clase. Sin la guarda, un re-serializado del array completo desde una foto vieja borra en silencio la regla que otro admin acaba de añadir — y una regla creada entre la confirmación y el commit sobrevive a R15, tras lo cual R10 plena reproduce el 422 del mes entero | Un `rev` obsoleto se rechaza como `stale_revision` y no escribe nada; y una regla creada entre la confirmación y el commit no se pierde ni sobrevive a espaldas de R10 |
| R17 | La **exclusión plena** de R10 entra solo cuando las reglas que nombran al retirado ya están resueltas (R15). El orden de **escritura** al retirar es otro: `retiredFrom` en el miembro **antes** que R15 al `solverConfig` (Behavior). R10 diferido cubre la ventana entre ambas escrituras y el legado P1→P3 | Invertir exclusión plena antes de resolver reglas es el `ValueError` del mes. Invertir escritura (`solverConfig` antes que miembro) borra reglas irreversiblemente si el flujo se abandona | Test diferimiento (R10.e); test post-R15 exclusión (R10.f); test orden de escritura; test estado parcial = reglas vivas + R10 diferido + solve exitoso |

## Scope

### In scope

- Exclusión del retirado **de worship** al construir el solve request — **plena** cuando no hay
  reglas vivas que lo nombren; **diferida** mientras una regla vigente lo nombra (pools,
  `availabilityRules`, `extraSupport`).
- Resolución de las reglas que lo nombran al retirar **de worship**, con la confirmación de R15.
- La guarda de revisión sobre el `solverConfig`.
- Aviso en el planner de retirados que siguen en los pools almacenados.

### Non-goals

- Cambiar `gcf/owt_solver_v2.py`. El solver se queda como está; todo se resuelve del lado del
  request.
- Migrar las reglas del solver de nombre a id (D4 del roadmap). R10 convive con los ids-string.
- Borrar los ids de pool del `solverConfig`. **Se conservan almacenados**; R10 plena los excluye
  al construir el request solo cuando no hay regla vigente que nombre al retirado.
- Limpiar retroactivamente reglas que ya nombran a gente inexistente — `"Vale Sosa"` es un dato,
  y arreglarlo es una operación consentida aparte.

## Behavior and invariants

- **Required behavior:** retirar de worship escribe `retiredFrom` y resuelve reglas (R15); R10
  plena excluye del request solo tras reglas resueltas; R10 diferido mantiene el request viable
  mientras las reglas siguen vivas. Retirar de kids (R18) no toca el solver.
- **Preserved behavior:** un mes sin retirados produce el mismo request que hoy, byte por byte.
  Si eso no se pinea, el riesgo deja de estar acotado.
- **Data invariants:** los ids de pool se conservan; el retiro sigue siendo reversible sin
  pérdida **excepto** por las reglas borradas, que no vuelven — asimetría deliberada que la UI
  declara antes de confirmar, no después.
- **Concurrency:** dos escrituras al `solverConfig` compiten. R15b es la respuesta.
- **Failure and recovery:** el retiro de worship deja de ser una sola escritura — toca el doc del
  miembro y el `solverConfig`. **Orden obligatorio al retirar de worship:** (1) escribir
  `retiredFrom` en el miembro; (2) escribir la resolución de R15 al `solverConfig`. R10 **diferido**
  hace que el paso 1 sea seguro: el solve sigue con reglas vivas. Si el paso 2 falla
  (`stale_revision`) o el operador cancela, el miembro ya está retirado de worship con reglas
  vivas y R10 diferido — el mismo estado legado P1→P3. El orden inverso —reglas resueltas antes
  de `retiredFrom`— borra reglas irreversiblemente mientras el miembro sigue activo en worship si
  el flujo se abandona; **prohibido**. R15b sólo cubre el paso 2; el PATCH del miembro no lleva
  guarda de revisión hoy (`members/[id]/route.ts`).

## Dependencies and constraints

- **Depende de P1** entregado: sin `retiredFrom` no hay a quién excluir.
- **Criterio de entrada al despliegue (reglas vivas, no pools):** desplegar P3 con **R10
  diferido** permitido cuando existan retirados de worship con reglas vivas (legado P1→P3). La
  **exclusión plena** (R10 plena) para cada miembro entra solo tras R15 resuelve sus reglas — no
  como condición global previa al despliegue. R15 no vuelve a visitar retirados ya existentes;
  el operador resuelve el legado reportado (sin escritura masiva automática). Distinto de
  “retirados ya en los pools” (ids almacenados; ver pregunta abierta).
- El plan de implementación debe pinear el request byte-idéntico para el caso sin retirados.

## Decisions

| Decision | Choice | Why | Tradeoffs | Owner |
|---|---|---|---|---|
| Alcance ministerial | Worship solamente | El solve request es worship; kids R18 es registro sin tocar solver. Sin predicado, worship-activo + kids-retired se excluiría del mes | P3 debe citar explícitamente R18 y el predicado de P1 R2 | P3 |
| Reglas que nombran a un retirado | Se resuelven al retirar de worship; confirmación siempre que nombren a alguien más | Elección de Frank. No es normalización silenciosa —lo que este trabajo prohíbe— porque es explícito, se enseña antes y se confirma. | El borrado de reglas **no se deshace** al des-retirar. | Frank |
| Ids de pool de un retirado | Se conservan almacenados; R10 plena los excluye al construir solo sin reglas vivas | Borrarlos haría el retiro no reversible sin pérdida. | El `solverConfig` conserva ids de retirados; el planner lo reporta. | P3 |
| Cambios al solver | Ninguno | Todo se resuelve del lado del request; tocar el solver amplía el radio a un servicio desplegado aparte. | Se vive con `known` armado sólo desde los pools. | P3 |

## Assumptions

| Assumption | Impact if false | Validation | Failure response |
|---|---|---|---|
| `allRulesToDs` y `availabilityRules` son las **únicas** fuentes de nombres en `dsl_rules` | Quedaría una tercera puerta al mismo 422 | Lectura exhaustiva de `buildSolveRequest` como primer paso de implementación; el test de request byte-idéntico ayuda pero no lo prueba | Extender R10 a lo que aparezca, antes de implementar |
| Un mes sin retirados produce hoy un request determinista | El test byte-idéntico sería inestable y no probaría nada | Ejecutarlo dos veces sobre el mismo input antes de confiar en él | Pinear el subconjunto determinista y decir cuál se excluyó |

## Open questions

| Question | Why it matters | Recommendation and why | Tradeoffs | Owner | Blocking? | Resolution point | Bounded default |
|---|---|---|---|---|---|---|---|
| ¿Qué pasa con un retirado que ya está en los pools cuando P3 se despliega? | Es la población real del día uno, no un caso hipotético | **Nada automático: reportarlos.** Una limpieza masiva al desplegar es una escritura a datos de producción sin consentimiento, y este repo lo prohíbe | El operador resuelve uno por uno | Frank | No | Implementación | Reportar, no escribir |
| ¿El aviso de "retirados en los pools" vive en el planner o en la pestaña Miembros? | Determina quién lo ve y cuándo | **En el planner**, junto a `unresolvedRuleNames`, que es donde ya se mira este tipo de problema | Quien retira no lo ve en el momento de retirar | Frank | No | Diseño de UI | Planner |

## Acceptance and verification

| Requirement | Acceptance evidence | Verification method |
|---|---|---|
| R10 | Exclusión plena sin reglas; diferimiento con reglas vivas; kids-only sigue | Los seis tests de `buildSolveRequest` |
| R15 | Worship: corte y confirmación; kids no toca `solverConfig`; post-R15 activa R10 plena | Tests worship + kids + R10.f |
| R15b | Un `rev` viejo se rechaza y no escribe | Test de `stale_revision`; test de la regla creada entre confirmación y commit |
| R17 | Exclusión plena tras R15; escritura miembro-primero; diferimiento seguro | Tests R10.e/f, orden de escritura, solve con reglas vivas |

## Terminal state

`READY_FOR_ADVERSARIAL_REVIEW` — las dos preguntas abiertas son no bloqueantes y tienen default
acotado. Riesgo **crítico**: dos `APPROVED` consecutivos sobre bytes idénticos.
