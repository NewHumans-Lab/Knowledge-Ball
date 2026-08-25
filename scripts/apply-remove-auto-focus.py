from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    text = file_path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {count}\n--- expected ---\n{old}")
    file_path.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    "src/ui/app.ts",
    "  onPickNode: id => scene.focusNode(id),\n",
    "  onPickNode: openNode,\n",
)

replace_once(
    "src/ui/scene/KnowledgeScene.ts",
    "  markDirty: () => void;\n  focusNode: (id: string) => void;\n  start: () => void;\n",
    "  markDirty: () => void;\n  start: () => void;\n",
)

replace_once(
    "src/ui/scene/KnowledgeScene.ts",
    "  let draggedNodeId: string | null = null;\n  let returningNodeId: string | null = null;\n  let focusedNodeId: string | null = null;\n  let focusTargetQuaternion: THREE.Quaternion | null = null;\n  let graphZoom = 1.27;\n",
    "  let draggedNodeId: string | null = null;\n  let returningNodeId: string | null = null;\n  let graphZoom = 1.27;\n",
)

replace_once(
    "src/ui/scene/KnowledgeScene.ts",
    """  const focusNode = (id: string) => {
    const node = getNodes().find(value => value.id === id);
    if (!node?.pos || node.pos.lengthSq() === 0 || isCoreNodeId(id)) return;
    selectedId = id;
    focusedNodeId = id;
    const direction = node.pos.clone().normalize().applyQuaternion(worldGroup.quaternion);
    const delta = new THREE.Quaternion().setFromUnitVectors(direction, new THREE.Vector3(0, 0, 1));
    focusTargetQuaternion = delta.multiply(worldGroup.quaternion.clone()).normalize();
    largeGraphDirty = true;
  };

  const updateNodeFocus = (dt: number) => {
    if (!focusTargetQuaternion) return false;
    worldGroup.quaternion.slerp(focusTargetQuaternion, 1 - Math.exp(-10 * dt));
    if (worldGroup.quaternion.angleTo(focusTargetQuaternion) < .001) {
      worldGroup.quaternion.copy(focusTargetQuaternion);
      focusTargetQuaternion = null;
      return false;
    }
    return true;
  };

""",
    "",
)

replace_once(
    "src/ui/scene/KnowledgeScene.ts",
    """    const shells = Object.values(nodeMap).filter(record => record.group.visible).map(record => record.shell);
    const focusedRecord = focusedNodeId && focusTargetQuaternion === null ? nodeMap[focusedNodeId] : undefined;
    if (mobilePerformance) {
      if (focusedRecord?.group.visible) {
        focusedRecord.group.getWorldPosition(worldPos);
        const projected = worldPos.clone().project(camera);
        if (hasFiniteCoordinates(projected)) {
          const sx = rect.left + (projected.x * .5 + .5) * rect.width;
          const sy = rect.top + (-projected.y * .5 + .5) * rect.height;
          if (Math.hypot(sx - x, sy - y) <= 24) return focusedNodeId;
        }
      }
      let nearest: { id: string; distance: number } | null = null;
""",
    """    const shells = Object.values(nodeMap).filter(record => record.group.visible).map(record => record.shell);
    if (mobilePerformance) {
      let nearest: { id: string; distance: number } | null = null;
""",
)

replace_once(
    "src/ui/scene/KnowledgeScene.ts",
    """    ndc.set(((x - rect.left) / rect.width) * 2 - 1, -(((y - rect.top) / rect.height) * 2 - 1));
    raycaster.setFromCamera(ndc, camera);
    if (focusedRecord?.group.visible && raycaster.intersectObject(focusedRecord.shell, false).length > 0) return focusedNodeId;
    const hit = raycaster.intersectObjects(shells, false)[0]?.object.parent?.userData.nodeId;
""",
    """    ndc.set(((x - rect.left) / rect.width) * 2 - 1, -(((y - rect.top) / rect.height) * 2 - 1));
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(shells, false)[0]?.object.parent?.userData.nodeId;
""",
)

replace_once(
    "src/ui/scene/KnowledgeScene.ts",
    """    } else if (mode === 'rotate') {
      focusedNodeId = null;
      focusTargetQuaternion = null;
      worldGroup.rotation.y += (e.clientX - lastX) * .004;
      worldGroup.rotation.x += (e.clientY - lastY) * .004;
      largeGraphDirty = true;
    } else if (mode === 'node' && draggedNodeId) {
      focusedNodeId = null;
      focusTargetQuaternion = null;
      const node = getNodes().find(value => value.id === draggedNodeId);
""",
    """    } else if (mode === 'rotate') {
      worldGroup.rotation.y += (e.clientX - lastX) * .004;
      worldGroup.rotation.x += (e.clientY - lastY) * .004;
      largeGraphDirty = true;
    } else if (mode === 'node' && draggedNodeId) {
      const node = getNodes().find(value => value.id === draggedNodeId);
""",
)

replace_once(
    "src/ui/scene/KnowledgeScene.ts",
    """      } else {
        // A real ordinary-ball tap now means “open this knowledge”. It must not
        // mutate the user's chosen 3D orientation. Cancel any earlier search
        // focus animation, keep the selected identity, and open detail directly.
        focusedNodeId = null;
        focusTargetQuaternion = null;
        window.setTimeout(() => callbacks.onNodeTap(nodeId), 0);
      }
""",
    """      } else {
        // A real ordinary-ball tap means “open this knowledge” without changing
        // the user's chosen 3D orientation.
        window.setTimeout(() => callbacks.onNodeTap(nodeId), 0);
      }
""",
)

replace_once(
    "src/ui/scene/KnowledgeScene.ts",
    "    const delay = largeMobileGraph && pendingNodeIds.size === 0 && draggedNodeId === null && returningNodeId === null && focusTargetQuaternion === null ? 100 : 0;\n",
    "    const delay = largeMobileGraph && pendingNodeIds.size === 0 && draggedNodeId === null && returningNodeId === null ? 100 : 0;\n",
)

replace_once(
    "src/ui/scene/KnowledgeScene.ts",
    """    const returnStillActive = updateReturningNode(dt);
    const focusStillActive = updateNodeFocus(dt);
    sync();
""",
    """    const returnStillActive = updateReturningNode(dt);
    sync();
""",
)

replace_once(
    "src/ui/scene/KnowledgeScene.ts",
    "    largeGraphDirty = returnStillActive || focusStillActive;\n",
    "    largeGraphDirty = returnStillActive;\n",
)

replace_once(
    "src/ui/scene/KnowledgeScene.ts",
    "  return {\n    markDirty: () => { largeGraphDirty = true; },\n    focusNode,\n    start: () => {\n",
    "  return {\n    markDirty: () => { largeGraphDirty = true; },\n    start: () => {\n",
)

replace_once(
    "src/ui/scene/KnowledgeSceneRegression.test.ts",
    """assert(!upSource.includes('focusNode(nodeId)'), 'ordinary real-ball tap must not rotate/focus the graph before opening detail');
assert(upSource.includes('focusTargetQuaternion = null'), 'real-ball tap must cancel any prior programmatic focus animation');
""",
    """assert(!upSource.includes('focusNode(nodeId)'), 'ordinary real-ball tap must not rotate/focus the graph before opening detail');
assert(!sceneSource.includes('focusNode'), 'automatic/programmatic node focus must stay removed from the scene API and implementation');
assert(!sceneSource.includes('focusedNodeId'), 'focused-node identity state from the old two-tap flow must stay removed');
assert(!sceneSource.includes('focusTargetQuaternion'), 'automatic quaternion focus target from the old centering flow must stay removed');
assert(!sceneSource.includes('updateNodeFocus'), 'automatic focus animation loop from the old centering flow must stay removed');
""",
)

replace_once(
    "src/ui/scene/KnowledgeSceneRegression.test.ts",
    """assert(!sceneSource.slice(detailSetterStart, resizeSetterStart).includes('focusNode(id)'), 'detail open/navigation must never rotate the graph');
assert(sceneSource.includes('const focusedRecord = focusedNodeId && focusTargetQuaternion === null ? nodeMap[focusedNodeId] : undefined;'), 'programmatic search focus must retain hit-test priority after it completes');
assert(sceneSource.includes('if (Math.hypot(sx - x, sy - y) <= 24) return focusedNodeId;'), 'mobile programmatic focus must remain easy to pick inside its 24px touch radius');
assert(sceneSource.includes('raycaster.intersectObject(focusedRecord.shell, false).length > 0'), 'desktop programmatic focus must retain focused-sphere hit priority');
""",
    """assert(!sceneSource.slice(detailSetterStart, resizeSetterStart).includes('focusNode(id)'), 'detail open/navigation must never rotate the graph');
assert(!sceneSource.includes('focusedRecord'), 'focused-node hit-test priority patch must stay removed with the centering flow');
""",
)

replace_once(
    "scripts/verify-mobile-browser.mjs",
    """    const searchTarget=targets[1];
    await page.evaluate(()=>window.__debug.scene.start());
    await page.locator('#aiInput').fill(searchTarget.title);
    const searchResult=page.locator(`[data-node-id=\"${searchTarget.id}\"]`).first();
    await searchResult.waitFor({state:'visible'});
    await searchResult.click();
    await page.waitForTimeout(900);
    assert.equal(await page.locator('#panel.open').count(),0,'search selection must focus without opening the legacy panel');
    assert.equal(await page.locator('#nodeDetailOverlay.open').count(),0,'search selection must focus without opening details');
    const searchCentered=await page.evaluate(id=>window.__debug.scene.screenPositionForNode(id),searchTarget.id);
    assert.ok(searchCentered,'search-focused node must remain renderable');
    assert.ok(Math.hypot(searchCentered.x-(hostBox.x+hostBox.width/2),searchCentered.y-(hostBox.y+hostBox.height/2))<4,'search selection must use the same center-focus behavior as a node tap');
    await page.touchscreen.tap(searchCentered.x,searchCentered.y);
    await page.locator('#nodeDetailOverlay.open').waitFor({state:'visible'});
    await page.locator('#nodeDetailOverlay .node-detail-close').click();
    await page.locator('#nodeDetailOverlay').waitFor({state:'hidden'});
""",
    """    const searchTarget=targets[1];
    await page.evaluate(()=>window.__debug.scene.start());
    const searchPointBefore=await page.evaluate(id=>window.__debug.scene.screenPositionForNode(id),searchTarget.id);
    assert.ok(searchPointBefore,'search target must remain renderable before selection');
    await page.locator('#aiInput').fill(searchTarget.title);
    const searchResult=page.locator(`[data-node-id=\"${searchTarget.id}\"]`).first();
    await searchResult.waitFor({state:'visible'});
    await searchResult.click();
    const searchDetail=page.locator('#nodeDetailOverlay.open');
    await searchDetail.waitFor({state:'visible'});
    assert.equal(await page.locator('#panel.open').count(),0,'search selection must open the near-node detail without the legacy panel');
    assert.equal((await searchDetail.locator('.node-detail-title').textContent())?.trim(),searchTarget.title,'search selection must directly open the selected knowledge detail');
    const searchPointAfter=await page.evaluate(id=>window.__debug.scene.screenPositionForNode(id),searchTarget.id);
    assert.ok(searchPointAfter,'search-selected node must remain renderable after detail opens');
    assert.ok(Math.hypot(searchPointAfter.x-searchPointBefore.x,searchPointAfter.y-searchPointBefore.y)<=2,'search selection must not rotate or auto-center the graph');
    await searchDetail.locator('.node-detail-close').click();
    await page.locator('#nodeDetailOverlay').waitFor({state:'hidden'});
""",
)

replace_once(
    "scripts/verify-mobile-browser.mjs",
    "  console.log('Mobile viewport, bright semantic colors, Personal node/edge visibility, split create exit, focus-before-details, near-node details, search focus, exit navigation, raycast and UI click checks passed');\n",
    "  console.log('Mobile viewport, bright semantic colors, Personal node/edge visibility, split create exit, direct node/search details, exit navigation, raycast and UI click checks passed');\n",
)

scene_source = Path("src/ui/scene/KnowledgeScene.ts").read_text(encoding="utf-8")
for forbidden in ("focusNode", "focusedNodeId", "focusTargetQuaternion", "updateNodeFocus", "focusedRecord"):
    if forbidden in scene_source:
        raise SystemExit(f"scene cleanup incomplete: found {forbidden}")

app_source = Path("src/ui/app.ts").read_text(encoding="utf-8")
if "scene.focusNode" in app_source:
    raise SystemExit("app cleanup incomplete: search still calls scene.focusNode")

print("Automatic focus/centering cleanup applied with exact-match guards.")
